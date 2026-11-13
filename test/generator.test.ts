import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateOperations, TAG_TOOLSETS, toToolName } from "../src/generator.js";

const TAGS = ["Other"];
const spec = (paths: unknown) => ({ paths });

describe("generateOperations", () => {
  it("builds a descriptor with the full final shape", () => {
    const [op] = generateOperations(
      spec({
        "/v3/application/shops/{shop_id}/listings": {
          post: {
            operationId: "createDraftListing",
            tags: ["ShopListing"],
            description: "Verbatim <b>text</b>",
            security: [{ api_key: [], oauth2: ["listings_w"] }],
            parameters: [
              { name: "shop_id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
              { name: "q", in: "query", schema: { type: "string" } },
            ],
          },
        },
      }),
    );
    expect(op).toEqual({
      toolName: "create_draft_listing",
      operationId: "createDraftListing",
      description: "Verbatim <b>text</b>",
      method: "POST",
      path: "/v3/application/shops/{shop_id}/listings",
      scopes: ["listings_w"],
      write: true,
      toolset: "listings",
      params: [
        { name: "shop_id", in: "path", required: true, type: "integer", minimum: 1 },
        { name: "q", in: "query", required: false, type: "string" },
      ],
    });
  });

  it("marks GET as non-write with no scopes when public", () => {
    const [op] = generateOperations(spec({ "/a": { get: { operationId: "getA", tags: TAGS } } }));
    expect(op.write).toBe(false);
    expect(op.scopes).toEqual([]);
  });

  it("fails on a missing operationId", () => {
    expect(() => generateOperations(spec({ "/a": { get: { tags: TAGS } } }))).toThrow(/Missing operationId/);
  });

  it("fails on a duplicate Tool name", () => {
    expect(() =>
      generateOperations(
        spec({ "/a": { get: { operationId: "getThing", tags: TAGS } }, "/b": { get: { operationId: "get_thing", tags: TAGS } } }),
      ),
    ).toThrow(/Duplicate Tool name "get_thing"/);
  });

  it("is deterministic regardless of path order", () => {
    const a = { operationId: "aOp", tags: TAGS };
    const b = { operationId: "bOp", tags: TAGS };
    expect(generateOperations(spec({ "/1": { get: b }, "/2": { get: a } }))).toEqual(
      generateOperations(spec({ "/2": { get: a }, "/1": { get: b } })),
    );
  });
});

describe("schema fidelity", () => {
  const param = (p: unknown, components?: unknown) =>
    generateOperations({
      components,
      paths: { "/a": { get: { operationId: "getA", tags: TAGS, parameters: [p] } } },
    })[0].params[0];

  it("resolves $ref parameters and schemas", () => {
    const p = param(
      { $ref: "#/components/parameters/Limit" },
      {
        parameters: { Limit: { name: "limit", in: "query", schema: { $ref: "#/components/schemas/Lim" } } },
        schemas: { Lim: { type: "integer", minimum: 1, maximum: 100 } },
      },
    );
    expect(p).toEqual({ name: "limit", in: "query", required: false, type: "integer", minimum: 1, maximum: 100 });
  });

  it("fails on an unresolvable $ref", () => {
    expect(() => param({ $ref: "#/components/parameters/Nope" }, {})).toThrow(/Unresolvable \$ref/);
  });

  it("keeps array item schemas with enums and bounds", () => {
    const p = param({
      name: "ids",
      in: "query",
      required: true,
      schema: { type: "array", items: { type: "integer", format: "int64", minimum: 1 } },
    });
    expect(p).toMatchObject({ type: "array", required: true, items: { type: "integer", minimum: 1 } });
    expect(
      param({ name: "inc", in: "query", schema: { type: "array", items: { type: "string", enum: ["A", "B"] } } })
        .items,
    ).toEqual({ type: "string", enum: ["A", "B"] });
  });

  it("treats nullable parameters as not required", () => {
    expect(
      param({ name: "x", in: "query", required: true, schema: { type: "boolean", nullable: true } }).required,
    ).toBe(false);
  });
});

describe("Toolset assignment", () => {
  const withTags = (tags?: string[]) =>
    generateOperations(spec({ "/a": { get: { operationId: "getA", ...(tags ? { tags } : {}) } } }));

  it("fails on an unmapped tag", () => {
    expect(() => withTags(["Brand New Tag"])).toThrow(/Unmapped tag "Brand New Tag"/);
  });

  it("fails on an unmapped tag named like an Object.prototype member", () => {
    expect(() => withTags(["constructor"])).toThrow(/Unmapped tag "constructor"/);
  });

  it("fails on an Operation without tags", () => {
    expect(() => withTags()).toThrow(/no tag/);
    expect(() => withTags([])).toThrow(/no tag/);
  });

  it("fails when tags map to different Toolsets", () => {
    expect(() => withTags(["Review", "User"])).toThrow(/multiple Toolsets/);
  });

  it("accepts several tags mapping to the same Toolset", () => {
    expect(withTags(["ShopListing", "ShopListing Image"])[0].toolset).toBe("listings");
  });

  it.each([
    ["ShopListing Video", "listings"],
    ["Shop Section", "shop"],
    ["Shop ShippingProfile", "shipping"],
    ["Shop HolidayPreferences", "shipping"],
    ["Ledger Entry", "orders"],
    ["Review", "reviews"],
    ["BuyerTaxonomy", "taxonomy"],
    ["UserAddress", "users"],
    ["Other", "other"],
  ])("maps %s to %s", (tag, toolset) => {
    expect(withTags([tag])[0].toolset).toBe(toolset);
  });

  it("maps exactly the tags in the Spec Snapshot", () => {
    const snapshot = JSON.parse(readFileSync(new URL("../spec/etsy-openapi.json", import.meta.url), "utf8"));
    expect(Object.keys(TAG_TOOLSETS).sort()).toEqual(snapshot.tags.map((t: { name: string }) => t.name).sort());
    expect(() => generateOperations(snapshot)).not.toThrow();
  });
});

describe("toToolName", () => {
  it("snake_cases operationIds", () => {
    expect(toToolName("getListingsByShop")).toBe("get_listings_by_shop");
    expect(toToolName("getURLThing")).toBe("get_url_thing");
  });
});
