import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateOperations, READ_ONLY_OVERRIDES, TAG_TOOLSETS, toToolName } from "../src/generator.js";

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
      oauth2: true,
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
    expect(op.oauth2).toBe(false);
  });

  it("flags oauth2 from the security requirement even without scopes", () => {
    const [op] = generateOperations(
      spec({ "/a": { get: { operationId: "getA", tags: TAGS, security: [{ api_key: [], oauth2: [] }] } } }),
    );
    expect(op.oauth2).toBe(true);
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

  it("keeps the nullable flag on parameters, array items and object properties", () => {
    expect(param({ name: "x", in: "query", schema: { type: "boolean", nullable: true } }).nullable).toBe(true);
    expect(param({ name: "x", in: "query", schema: { type: "boolean" } }).nullable).toBeUndefined();
    const p = param({
      name: "o",
      in: "query",
      schema: { type: "array", items: { type: "object", properties: { a: { type: "string", nullable: true } } } },
    });
    expect(p.items?.properties).toEqual([{ name: "a", required: false, type: "string", nullable: true }]);
  });

  it("treats nullable parameters as not required", () => {
    expect(
      param({ name: "x", in: "query", required: true, schema: { type: "boolean", nullable: true } }).required,
    ).toBe(false);
  });
});

describe("request bodies", () => {
  const withBody = (content: unknown, parameters: unknown[] = []) =>
    generateOperations(
      spec({
        "/a/{id}": {
          post: { operationId: "postA", tags: TAGS, parameters, requestBody: { content } },
        },
      }),
    )[0];
  const id = { name: "id", in: "path", required: true, schema: { type: "integer" } };

  it("flattens form-encoded body fields after path/query params with their location", () => {
    const op = withBody(
      {
        "application/x-www-form-urlencoded": {
          schema: {
            type: "object",
            required: ["title", "gone"],
            properties: {
              title: { type: "string", description: "T" },
              gone: { type: "integer", nullable: true },
              tags: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      [id],
    );
    expect(op.params).toEqual([
      { name: "id", in: "path", required: true, type: "integer" },
      { name: "title", in: "body-form", required: true, type: "string", description: "T" },
      { name: "gone", in: "body-form", required: false, type: "integer", nullable: true },
      { name: "tags", in: "body-form", required: false, type: "array", items: { type: "string" } },
    ]);
  });

  it("keeps nested objects and arrays of objects for JSON bodies, resolving $refs", () => {
    const op = generateOperations({
      components: { schemas: { Item: { type: "object", required: ["n"], properties: { n: { type: "integer", minimum: 1 } } } } },
      paths: {
        "/a": {
          put: {
            operationId: "putA",
            tags: TAGS,
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["items"],
                    properties: { items: { type: "array", items: { $ref: "#/components/schemas/Item" } } },
                  },
                },
              },
            },
          },
        },
      },
    })[0];
    expect(op.params).toEqual([
      {
        name: "items",
        in: "body-json",
        required: true,
        type: "array",
        items: { type: "object", properties: [{ name: "n", required: true, type: "integer", minimum: 1 }] },
      },
    ]);
  });

  it("marks multipart fields, with binary ones as files", () => {
    const op = withBody({
      "multipart/form-data": {
        schema: {
          type: "object",
          properties: { image: { type: "string", format: "binary", nullable: true }, rank: { type: "integer" } },
        },
      },
    });
    expect(op.params.map((p) => [p.name, p.in])).toEqual([
      ["image", "body-multipart-file"],
      ["rank", "body-multipart"],
    ]);
  });

  it("fails when a body field collides with a path or query parameter", () => {
    expect(() =>
      withBody({ "application/json": { schema: { type: "object", properties: { id: { type: "integer" } } } } }, [id]),
    ).toThrow(/Body field "id" collides/);
  });

  it("fails on an unsupported content type", () => {
    expect(() => withBody({ "text/plain": { schema: { type: "object" } } })).toThrow(/Unsupported request body/);
  });

  it("fails on nested objects in a form-encoded body", () => {
    expect(() =>
      withBody({
        "application/x-www-form-urlencoded": {
          schema: { type: "object", properties: { o: { type: "object", properties: { a: { type: "string" } } } } },
        },
      }),
    ).toThrow(/Form-encoded body field "o"/);
  });
});

describe("Write Tool flag", () => {
  const op = (method: string, operationId: string) =>
    generateOperations(spec({ "/a": { [method]: { operationId, tags: TAGS } } }))[0];

  it.each(["post", "put", "patch", "delete"])("flags %s as a Write Tool", (m) => {
    expect(op(m, "doA").write).toBe(true);
  });

  it("exempts the read-only override list, initially only tokenScopes", () => {
    expect([...READ_ONLY_OVERRIDES]).toEqual(["tokenScopes"]);
    expect(op("post", "tokenScopes").write).toBe(false);
  });

  it("makes exactly the 64 GETs plus tokenScopes read-only in the Spec Snapshot", () => {
    const snapshot = JSON.parse(readFileSync(new URL("../spec/etsy-openapi.json", import.meta.url), "utf8"));
    const ops = generateOperations(snapshot);
    expect(ops.filter((o) => !o.write)).toHaveLength(65);
    expect(ops.filter((o) => !o.write && o.method !== "GET").map((o) => o.toolName)).toEqual(["token_scopes"]);
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
