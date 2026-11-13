import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { operations } from "./generated/operations.js";
import type { ParamDescriptor, ValueSchema } from "./operation.js";

export type FetchLike = (url: URL, init: { headers: Record<string, string> }) => Promise<Response>;

const API_BASE = "https://openapi.etsy.com";

export function valueSchema(v: ValueSchema): z.ZodType {
  if (v.type === "array") {
    return z.array(v.items ? valueSchema(v.items) : z.string()).min(1);
  }
  if (v.enum && (v.type === "integer" || v.type === "number")) {
    const literals = v.enum.map((e) => z.literal(e));
    return literals.length === 1 ? literals[0] : z.union(literals as [z.ZodLiteral, z.ZodLiteral, ...z.ZodLiteral[]]);
  }
  if (v.type === "integer" || v.type === "number") {
    let n = v.type === "integer" ? z.number().int() : z.number();
    if (v.minimum !== undefined) n = n.min(v.minimum);
    if (v.maximum !== undefined) n = n.max(v.maximum);
    return n;
  }
  if (v.type === "boolean") return z.boolean();
  if (v.enum) return z.enum(v.enum as [string, ...string[]]);
  return z.string();
}

function paramSchema(p: ParamDescriptor): z.ZodType {
  let s = valueSchema(p);
  if (p.description) s = s.describe(p.description);
  return p.required ? s : s.optional();
}

export function createServer(config: Config, fetchImpl: FetchLike = fetch): McpServer {
  const server = new McpServer({ name: "etsy-mcp", version: "0.1.1" });

  for (const op of operations.filter((op) => !op.write)) {
    const inputSchema = Object.fromEntries(op.params.map((p) => [p.name, paramSchema(p)]));
    server.registerTool(
      op.toolName,
      { description: op.description, inputSchema },
      async (args: Record<string, unknown>) => {
        let path = op.path;
        const url = new URL(API_BASE);
        for (const p of op.params) {
          const v = args[p.name];
          if (v === undefined) continue;
          if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
          else url.searchParams.set(p.name, Array.isArray(v) ? v.join(",") : String(v));
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
