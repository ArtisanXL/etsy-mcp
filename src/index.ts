#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://openapi.etsy.com/v3/application";
const apiKey = process.env.ETSY_API_KEY;
const accessToken = process.env.ETSY_ACCESS_TOKEN;

async function etsy(path: string, params?: Record<string, string | number | undefined>) {
  if (!apiKey) throw new Error("ETSY_API_KEY environment variable is required");
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { "x-api-key": apiKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, { headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`Etsy API ${res.status}: ${body}`);
  return body;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const server = new McpServer({ name: "etsy-mcp", version: "0.1.0" });

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

await server.connect(new StdioServerTransport());
