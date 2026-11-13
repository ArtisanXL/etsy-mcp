import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { valueSchema } from "../src/server.js";
import { connect } from "./harness.js";

describe("tools/list", () => {
  it("lists the 64 generated read tools with spec descriptions", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(64);
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_listing");
    expect(names).not.toContain("search_listings");
    expect(names).not.toContain("create_draft_listing");
    expect(tools.find((t) => t.name === "get_listing")?.description).toContain(
      "Retrieves a listing record by listing ID",
    );
  });
});

describe("tools/call", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["get_listing", { listing_id: 7 }, "/v3/application/listings/7"],
    ["get_listing", { listing_id: 7, language: "de" }, "/v3/application/listings/7?language=de"],
    ["find_shops", { shop_name: "x y", limit: 5 }, "/v3/application/shops?shop_name=x+y&limit=5"],
    [
      "get_listings_by_shop",
      { shop_id: 3, limit: 1, offset: 2 },
      "/v3/application/shops/3/listings?limit=1&offset=2",
    ],
  ];

  it.each(cases)("%s sends the expected request", async (name, args, pathAndQuery) => {
    const { client, requests } = await connect();
    const res = await client.callTool({ name, arguments: args });
    expect(res.content).toEqual([{ type: "text", text: '{"ok":true}' }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url.href).toBe("https://openapi.etsy.com" + pathAndQuery);
    expect(requests[0].headers["x-api-key"]).toBe("key:secret");
    expect(requests[0].headers.Authorization).toBeUndefined();
  });

  it("sends array parameters as one comma-joined value", async () => {
    const { client, requests } = await connect();
    await client.callTool({
      name: "get_listings_by_listing_ids",
      arguments: { listing_ids: [1, 2, 3], includes: ["Images", "Shop"] },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url.search).toBe("?listing_ids=1%2C2%2C3&includes=Images%2CShop");
    expect(requests[0].url.searchParams.get("listing_ids")).toBe("1,2,3");
  });

  it("passes ETSY_ACCESS_TOKEN through as a bearer token", async () => {
    const { client, requests } = await connect({ accessToken: "tok" });
    await client.callTool({ name: "get_shop", arguments: { shop_id: 1 } });
    expect(requests[0].headers.Authorization).toBe("Bearer tok");
  });

  it("returns a tool error on non-2xx", async () => {
    const { client } = await connect({}, () => new Response("nope", { status: 404 }));
    const res = await client.callTool({ name: "get_shop", arguments: { shop_id: 1 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Etsy API 404: nope");
  });
});

describe("input validation", () => {
  const rejected: [string, string, Record<string, unknown>][] = [
    ["invalid enum", "get_listings_by_listing_ids", { listing_ids: [1], includes: ["Bogus"] }],
    ["invalid enum on a plain param", "get_listings_by_shop", { shop_id: 1, state: "bogus" }],
    ["below minimum", "get_listing", { listing_id: 0 }],
    ["above maximum", "get_listings_by_shop", { shop_id: 1, limit: 101 }],
    ["wrong type", "get_listing", { listing_id: "abc" }],
    ["non-integer", "get_listing", { listing_id: 1.5 }],
    ["missing required", "get_listing", {}],
    ["array item below minimum", "get_listings_by_listing_ids", { listing_ids: [0] }],
    ["empty array", "get_listings_by_listing_ids", { listing_ids: [] }],
    ["empty optional array", "get_listings_by_listing_ids", { listing_ids: [1], includes: [] }],
    ["scalar for array", "get_listings_by_listing_ids", { listing_ids: 5 }],
  ];

  it.each(rejected)("rejects %s before any HTTP call", async (_label, name, args) => {
    const { client, requests } = await connect();
    const res = await client.callTool({ name, arguments: args });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/Input validation error/);
    expect(requests).toHaveLength(0);
  });

  it("matches the spec's required/optional for a sample of Operations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const schema = (n: string) => tools.find((t) => t.name === n)!.inputSchema as {
      required?: string[];
      properties: Record<string, { type?: string; items?: { type?: string }; maximum?: number }>;
    };
    const byIds = schema("get_listings_by_listing_ids");
    expect(byIds.required).toEqual(["listing_ids"]);
    expect(byIds.properties.listing_ids).toMatchObject({ type: "array", items: { type: "integer" } });
    expect(Object.keys(byIds.properties)).toContain("includes");

    const byShop = schema("get_listings_by_shop");
    expect(byShop.required).toEqual(["shop_id"]);
    expect(byShop.properties.limit.maximum).toBe(100);

    const receipts = schema("get_shop_receipts");
    expect(receipts.required).toEqual(["shop_id"]);
    expect(receipts.properties.was_paid.type).toBe("boolean");
  });
});

describe("valueSchema", () => {
  it("enforces numeric enums", () => {
    const s = valueSchema({ type: "integer", enum: [1, 2, 3] });
    expect(s.safeParse(2).success).toBe(true);
    expect(s.safeParse(4).success).toBe(false);
    expect(valueSchema({ type: "number", enum: [1.5] }).safeParse(2).success).toBe(false);
  });
});

describe("loadConfig", () => {
  it("fails when ETSY_API_KEY is missing", () => {
    expect(() => loadConfig({ ETSY_SHARED_SECRET: "s" })).toThrow(/ETSY_API_KEY/);
  });
  it("fails when ETSY_SHARED_SECRET is missing", () => {
    expect(() => loadConfig({ ETSY_API_KEY: "k" })).toThrow(/ETSY_SHARED_SECRET/);
  });
  it("accepts key and secret", () => {
    expect(loadConfig({ ETSY_API_KEY: "k", ETSY_SHARED_SECRET: "s" })).toEqual({
      apiKey: "k",
      sharedSecret: "s",
      accessToken: undefined,
    });
  });
});
