import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { connect } from "./harness.js";

describe("tools/list", () => {
  it("lists the 5 tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "find_shops",
      "get_listing",
      "get_shop",
      "get_shop_listings",
      "search_listings",
    ]);
  });
});

describe("tools/call", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["get_shop", { shop_id: 12 }, "/v3/application/shops/12"],
    ["find_shops", { shop_name: "x y", limit: 5 }, "/v3/application/shops?shop_name=x+y&limit=5"],
    ["get_listing", { listing_id: 7 }, "/v3/application/listings/7"],
    [
      "search_listings",
      { keywords: "mug", limit: 2, offset: 4 },
      "/v3/application/listings/active?keywords=mug&limit=2&offset=4",
    ],
    [
      "get_shop_listings",
      { shop_id: 3, limit: 1 },
      "/v3/application/shops/3/listings/active?limit=1",
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
