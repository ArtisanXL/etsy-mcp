import { describe, expect, it } from "vitest";
import { generateOperations, toToolName } from "../src/generator.js";

const spec = (paths: unknown) => ({ paths });

describe("generateOperations", () => {
  it("builds a descriptor with the full final shape", () => {
    const [op] = generateOperations(
      spec({
        "/v3/application/shops/{shop_id}/listings": {
          post: {
            operationId: "createDraftListing",
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
      toolset: "all",
      params: [
        { name: "shop_id", in: "path", required: true, type: "integer", minimum: 1 },
        { name: "q", in: "query", required: false, type: "string" },
      ],
    });
  });

  it("marks GET as non-write with no scopes when public", () => {
    const [op] = generateOperations(spec({ "/a": { get: { operationId: "getA" } } }));
    expect(op.write).toBe(false);
    expect(op.scopes).toEqual([]);
  });

  it("fails on a missing operationId", () => {
    expect(() => generateOperations(spec({ "/a": { get: {} } }))).toThrow(/Missing operationId/);
  });

  it("fails on a duplicate Tool name", () => {
    expect(() =>
      generateOperations(
        spec({ "/a": { get: { operationId: "getThing" } }, "/b": { get: { operationId: "get_thing" } } }),
      ),
    ).toThrow(/Duplicate Tool name "get_thing"/);
  });

  it("is deterministic regardless of path order", () => {
    const a = { operationId: "aOp" };
    const b = { operationId: "bOp" };
    expect(generateOperations(spec({ "/1": { get: b }, "/2": { get: a } }))).toEqual(
      generateOperations(spec({ "/2": { get: a }, "/1": { get: b } })),
    );
  });
});

describe("toToolName", () => {
  it("snake_cases operationIds", () => {
    expect(toToolName("getListingsByShop")).toBe("get_listings_by_shop");
    expect(toToolName("getURLThing")).toBe("get_url_thing");
  });
});
