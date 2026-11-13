import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";

export type FetchLike = (url: URL, init: { headers: Record<string, string> }) => Promise<Response>;

const API_BASE = "https://openapi.etsy.com";
const API_PREFIX = "/v3/application";

export function createServer(config: Config, fetchImpl: FetchLike = fetch): McpServer {
  async function etsy(path: string, params?: Record<string, string | number | undefined>) {
    const url = new URL(API_BASE + API_PREFIX + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "x-api-key": `${config.apiKey}:${config.sharedSecret}`,
    };
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
    const res = await fetchImpl(url, { headers });
    const body = await res.text();
    if (!res.ok) throw new Error(`Etsy API ${res.status}: ${body}`);
    return body;
  }

  const server = new McpServer({ name: "etsy-mcp", version: "0.1.1" });
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });


  server.registerTool(
    "get_shop",
    {
      description: "Get an Etsy shop by its numeric shop_id",
      inputSchema: { shop_id: z.number().int() },
    },
    async ({ shop_id }) => text(await etsy(`/shops/${shop_id}`)),
  );

  server.registerTool(
    "find_shops",
    {
      description: "Search Etsy shops by name",
      inputSchema: {
        shop_name: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ shop_name, limit }) => text(await etsy("/shops", { shop_name, limit })),
  );

  server.registerTool(
    "get_listing",
    {
      description: "Get an Etsy listing by its listing_id",
      inputSchema: { listing_id: z.number().int() },
    },
    async ({ listing_id }) => text(await etsy(`/listings/${listing_id}`)),
  );

  server.registerTool(
    "search_listings",
    {
      description: "Search active Etsy listings by keywords",
      inputSchema: {
        keywords: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ keywords, limit, offset }) =>
      text(await etsy("/listings/active", { keywords, limit, offset })),
  );

  server.registerTool(
    "get_shop_listings",
    {
      description: "List active listings for a shop",
      inputSchema: {
        shop_id: z.number().int(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ shop_id, limit, offset }) =>
      text(await etsy(`/shops/${shop_id}/listings/active`, { limit, offset })),
  );

  return server;
}
