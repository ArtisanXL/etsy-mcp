import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { operations } from "./generated/operations.js";
import type { ParamDescriptor } from "./operation.js";

export type FetchLike = (url: URL, init: { headers: Record<string, string> }) => Promise<Response>;

const API_BASE = "https://openapi.etsy.com";

function paramSchema(p: ParamDescriptor): z.ZodType {
  let s: z.ZodType;
  if (p.type === "integer" || p.type === "number") {
    let n = p.type === "integer" ? z.number().int() : z.number();
    if (p.minimum !== undefined) n = n.min(p.minimum);
    if (p.maximum !== undefined) n = n.max(p.maximum);
    s = n;
  } else if (p.type === "boolean") {
    s = z.boolean();
  } else if (p.enum) {
    s = z.enum(p.enum as [string, ...string[]]);
  } else {
    s = z.string();
  }
  if (p.description) s = s.describe(p.description);
  return p.required ? s : s.optional();
}

export function createServer(config: Config, fetchImpl: FetchLike = fetch): McpServer {
  const server = new McpServer({ name: "etsy-mcp", version: "0.1.1" });

  for (const op of operations.filter((op) => !op.write)) {
    const params = op.params.filter((p) => p.type !== "array");
    const inputSchema = Object.fromEntries(params.map((p) => [p.name, paramSchema(p)]));
    server.registerTool(
      op.toolName,
      { description: op.description, inputSchema },
      async (args: Record<string, unknown>) => {
        let path = op.path;
        const url = new URL(API_BASE);
        for (const p of params) {
          const v = args[p.name];
          if (v === undefined) continue;
          if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
          else url.searchParams.set(p.name, String(v));
        }
        url.pathname = path;
        const headers: Record<string, string> = {
          "x-api-key": `${config.apiKey}:${config.sharedSecret}`,
        };
        if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
        const res = await fetchImpl(url, { headers });
        const body = await res.text();
        if (!res.ok) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Etsy API ${res.status}: ${body}` }],
          };
        }
        return { content: [{ type: "text" as const, text: body }] };
      },
    );
  }

  return server;
}
