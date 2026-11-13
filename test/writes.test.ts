import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { operations } from "../src/generated/operations.js";
import { connect, tempConfigDir } from "./harness.js";

const NOW = 1_700_000_000_000;
const now = () => NOW;

function authedConfigDir() {
  const dir = tempConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tokens.json"), JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: NOW + 3_600_000 }));
  return dir;
}

const writing = async (respond?: Parameters<typeof connect>[1]) =>
  connect({ allowWrites: true, configDir: authedConfigDir() }, respond, { now });

const listNames = async (c: Awaited<ReturnType<typeof connect>>) => (await c.client.listTools()).tools.map((t) => t.name);

describe("Read-only Mode", () => {
  it("offers no Write Tools by default but keeps token_scopes", async () => {
    const names = await listNames(await connect());
    expect(names).toContain("token_scopes");
    const writeNames = operations.filter((op) => op.write).map((op) => op.toolName);
    expect(writeNames.length).toBeGreaterThan(0);
    expect(names.filter((n) => writeNames.includes(n))).toEqual([]);
    for (const n of ["create_draft_listing", "update_listing", "delete_listing_image", "update_listing_inventory"]) {
      expect(names).not.toContain(n);
    }
  });

  it("rejects calling a Write Tool by name", async () => {
    const { client, requests } = await connect();
    const res = await client.callTool({ name: "delete_shop_section", arguments: { shop_id: 1, shop_section_id: 2 } });
    expect(res.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe("ETSY_ALLOW_WRITES=true", () => {
  it("offers Write Tools, except multipart Operations until uploads land", async () => {
    const names = await listNames(await writing());
    for (const n of ["create_draft_listing", "update_listing", "delete_listing", "update_listing_inventory", "token_scopes"]) {
      expect(names).toContain(n);
    }
    expect(names).toHaveLength(operations.length - 3);
    for (const n of ["upload_listing_image", "upload_listing_file", "upload_listing_video"]) {
      expect(names).not.toContain(n);
    }
  });

  it("still honours ETSY_TOOLSETS", async () => {
    const c = await connect({ allowWrites: true, toolsets: ["reviews"] });
    expect(await listNames(c)).not.toContain("create_draft_listing");
  });
});

describe("form-encoded bodies", () => {
  it("create_draft_listing sends a form body with tags comma-joined", async () => {
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "create_draft_listing",
      arguments: {
        shop_id: 9,
        quantity: 3,
        title: "Mug & cup",
        description: "d",
        price: 12.5,
        who_made: "i_did",
        when_made: "made_to_order",
        taxonomy_id: 1234,
        tags: ["blue", "ceramic mug"],
        image_ids: [5, 6],
        is_supply: false,
      },
    });
    expect(res.isError).toBeFalsy();
    const [req] = requests;
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://openapi.etsy.com/v3/application/shops/9/listings");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(req.headers.Authorization).toBe("Bearer a");
    expect(req.headers["x-api-key"]).toBe("key:secret");
    const form = new URLSearchParams(req.body);
    expect(form.get("tags")).toBe("blue,ceramic mug");
    expect(form.get("image_ids")).toBe("5,6");
    expect(form.get("quantity")).toBe("3");
    expect(form.get("price")).toBe("12.5");
    expect(form.get("title")).toBe("Mug & cup");
    expect(form.get("is_supply")).toBe("false");
    expect(form.has("shop_id")).toBe(false);
    expect(req.url.search).toBe("");
  });

  it("uses the Operation's own method and path params for PATCH", async () => {
    const { client, requests } = await writing();
    await client.callTool({ name: "update_listing", arguments: { shop_id: 1, listing_id: 2, title: "t" } });
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].url.pathname).toBe("/v3/application/shops/1/listings/2");
    expect(requests[0].body).toBe("title=t");
  });

  it("sends token_scopes as a form POST with only the API key (public)", async () => {
    const { client, requests } = await connect();
    await client.callTool({ name: "token_scopes", arguments: { token: "abc" } });
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(requests[0].body).toBe("token=abc");
    expect(requests[0].headers.Authorization).toBeUndefined();
  });
});

describe("JSON bodies", () => {
  const products = [
    {
      sku: "S1",
      property_values: [{ property_id: 100, value_ids: [1, 2], values: ["Red", "Blue"] }],
      offerings: [{ price: 9.99, quantity: 4, is_enabled: true, readiness_state_id: 7 }],
    },
  ];

  it("update_listing_inventory sends nested products as real JSON", async () => {
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "update_listing_inventory",
      arguments: { listing_id: 55, products, price_on_property: [100] },
    });
    expect(res.isError).toBeFalsy();
    const [req] = requests;
    expect(req.method).toBe("PUT");
    expect(req.url.href).toBe("https://openapi.etsy.com/v3/application/listings/55/inventory");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(req.body!)).toEqual({ products, price_on_property: [100] });
  });

  it("validates nested fields before any HTTP call", async () => {
    const { client, requests } = await writing();
    const bad = [{ offerings: [{ price: 1, quantity: 1, is_enabled: "yes", readiness_state_id: 1 }] }];
    const res = await client.callTool({ name: "update_listing_inventory", arguments: { listing_id: 1, products: bad } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/Input validation error/);
    expect(requests).toHaveLength(0);
  });

  it("sends an empty JSON object when every body field is optional and omitted", async () => {
    const { client, requests } = await writing();
    await client.callTool({ name: "create_receipt_shipment", arguments: { shop_id: 1, receipt_id: 2 } });
    expect(requests[0].body).toBe("{}");
  });
});

describe("empty arrays and null in bodies", () => {
  it("update_listing accepts an empty array to clear tags, sent as an empty form value", async () => {
    const { client, requests } = await writing();
    const res = await client.callTool({ name: "update_listing", arguments: { shop_id: 1, listing_id: 2, tags: [] } });
    expect(res.isError).toBeFalsy();
    expect(requests[0].body).toBe("tags=");
  });

  it("update_listing_inventory accepts empty nested arrays and sends them as JSON", async () => {
    const { client, requests } = await writing();
    const products = [
      { sku: "S", property_values: [], offerings: [{ price: 1, quantity: 1, is_enabled: true, readiness_state_id: 1 }] },
    ];
    const res = await client.callTool({
      name: "update_listing_inventory",
      arguments: { listing_id: 1, products, price_on_property: [] },
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(requests[0].body!)).toEqual({ products, price_on_property: [] });
  });

  it("still rejects an empty array for a query parameter", async () => {
    const { client, requests } = await connect();
    const res = await client.callTool({ name: "get_listings_by_listing_ids", arguments: { listing_ids: [] } });
    expect(res.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("sends explicit nulls in nested JSON bodies as-is", async () => {
    const { client, requests } = await writing();
    const products = [
      {
        sku: null,
        property_values: [{ property_id: 1, value_ids: [2], scale_id: null, values: ["x"] }],
        offerings: [{ price: 1, quantity: 1, is_enabled: true, readiness_state_id: null }],
      },
    ];
    const res = await client.callTool({ name: "update_listing_inventory", arguments: { listing_id: 1, products } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(requests[0].body!)).toEqual({ products });
  });

  it("sends a top-level null in a JSON body", async () => {
    const { client, requests } = await writing();
    await client.callTool({
      name: "create_receipt_shipment",
      arguments: { shop_id: 1, receipt_id: 2, mail_class: null, tracking_code: "T" },
    });
    expect(JSON.parse(requests[0].body!)).toEqual({ mail_class: null, tracking_code: "T" });
  });

  it("omits null from form bodies", async () => {
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "update_listing",
      arguments: { shop_id: 1, listing_id: 2, title: "t", shipping_profile_id: null },
    });
    expect(res.isError).toBeFalsy();
    expect(requests[0].body).toBe("title=t");
  });

  it("omits null from query strings", async () => {
    const { client, requests } = await writing();
    const res = await client.callTool({ name: "get_shop_receipts", arguments: { shop_id: 1, was_paid: null, limit: 5 } });
    expect(res.isError).toBeFalsy();
    expect(requests[0].url.search).toBe("?limit=5");
  });
});

describe("DELETE and auth", () => {
  it("sends DELETE without a body or Content-Type", async () => {
    const { client, requests } = await writing(() => new Response(null, { status: 204 }));
    const res = await client.callTool({ name: "delete_shop_section", arguments: { shop_id: 1, shop_section_id: 2 } });
    expect(res.isError).toBeFalsy();
    expect(requests[0].method).toBe("DELETE");
    expect(requests[0].body).toBeUndefined();
    expect(requests[0].headers["Content-Type"]).toBeUndefined();
  });

  it("requires a token for oauth2 writes", async () => {
    const { client, requests } = await connect({ allowWrites: true, configDir: join(tempConfigDir(), "none") });
    const res = await client.callTool({ name: "delete_shop_section", arguments: { shop_id: 1, shop_section_id: 2 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/login/);
    expect(requests).toHaveLength(0);
  });

  it("re-sends the body unchanged after a 401 refresh", async () => {
    const dir = authedConfigDir();
    let calls = 0;
    const { client, requests } = await connect({ allowWrites: true, configDir: dir }, (req) => {
      if (req.url.pathname.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }));
      }
      return new Response("{}", { status: ++calls === 1 ? 401 : 200 });
    }, { now });
    const res = await client.callTool({ name: "update_listing", arguments: { shop_id: 1, listing_id: 2, title: "t" } });
    expect(res.isError).toBeFalsy();
    const writes = requests.filter((r) => r.method === "PATCH");
    expect(writes.map((r) => r.body)).toEqual(["title=t", "title=t"]);
    expect(writes[1].headers.Authorization).toBe("Bearer a2");
  });
});

describe("annotations", () => {
  const annotationsOf = async (name: string) => {
    const { tools } = await (await writing()).client.listTools();
    return tools.find((t) => t.name === name)?.annotations;
  };

  it.each([
    ["get_listing", { readOnlyHint: true, openWorldHint: true }],
    ["create_draft_listing", { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }],
    ["update_listing_inventory", { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }],
    ["update_listing", { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }],
    ["delete_listing", { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }],
    ["token_scopes", { readOnlyHint: true, openWorldHint: true }],
  ])("%s", async (name, expected) => {
    expect(await annotationsOf(name)).toEqual(expected);
  });

  it("every Tool is open-world and read-only matches the Write flag", async () => {
    const { tools } = await (await writing()).client.listTools();
    const writeNames = new Set(operations.filter((op) => op.write).map((op) => op.toolName));
    for (const t of tools) {
      expect(t.annotations?.openWorldHint).toBe(true);
      expect(t.annotations?.readOnlyHint).toBe(!writeNames.has(t.name));
    }
  });

  it("annotates Tools in the default mode too", async () => {
    const { tools } = await (await connect()).client.listTools();
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });
});

describe("flat input schema", () => {
  it("presents path, query and body fields as one set", async () => {
    const { tools } = await (await writing()).client.listTools();
    const schema = tools.find((t) => t.name === "create_draft_listing")!.inputSchema as {
      required?: string[];
      properties: Record<string, { type?: string; items?: { type?: string } }>;
    };
    expect(schema.required).toEqual(
      expect.arrayContaining(["shop_id", "quantity", "title", "description", "price", "who_made", "when_made", "taxonomy_id"]),
    );
    expect(JSON.stringify(schema.properties.tags)).toContain('"items":{"type":"string"}');
    expect(schema.properties.taxonomy_id.type).toBe("integer");
  });

  it("exposes nested object schemas for JSON bodies", async () => {
    const { tools } = await (await writing()).client.listTools();
    const schema = tools.find((t) => t.name === "update_listing_inventory")!.inputSchema as unknown as {
      properties: { products: { items: { properties: Record<string, unknown>; required?: string[] } } };
    };
    expect(Object.keys(schema.properties.products.items.properties)).toEqual(
      expect.arrayContaining(["sku", "property_values", "offerings"]),
    );
    expect(schema.properties.products.items.required).toEqual(["offerings"]);
  });
});
