import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { LOGIN_COMMAND, TokenError, TokenStore } from "./token-store.js";
import { operations } from "./generated/operations.js";
import type { ParamDescriptor, ValueSchema } from "./operation.js";

export interface FetchInit {
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}
export type FetchLike = (url: URL, init: FetchInit) => Promise<Response>;

export interface ServerDeps {
  fetch?: FetchLike;
  now?: () => number;
}

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

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export function createServer(config: Config, deps: ServerDeps = {}): McpServer {
  const fetchImpl = deps.fetch ?? fetch;
  const tokens = new TokenStore({
    configDir: config.configDir,
    apiKey: config.apiKey,
    seedRefreshToken: config.refreshToken,
    fetch: fetchImpl,
    now: deps.now,
  });
  const server = new McpServer({ name: "etsy-mcp", version: "0.1.1" });

  const enabled = config.toolsets && new Set<string>(config.toolsets);
  for (const op of operations.filter((op) => !op.write && (!enabled || enabled.has(op.toolset)))) {
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
        const send = (bearer?: string) => {
          const headers: Record<string, string> = { "x-api-key": `${config.apiKey}:${config.sharedSecret}` };
          if (bearer) headers.Authorization = `Bearer ${bearer}`;
          return fetchImpl(url, { headers });
        };
        const needsOAuth = op.oauth2;
        let res: Response;
        try {
          if (needsOAuth) {
            const token = await tokens.getAccessToken();
            res = await send(token);
            if (res.status === 401) {
              await res.body?.cancel();
              res = await send(await tokens.refreshAfterRejection(token));
            }
          } else {
            res = await send();
          }
        } catch (err) {
          if (err instanceof TokenError) return errorResult(`${err.message} (needed by ${op.toolName})`);
          throw err;
        }
        const body = await res.text();
        if (!res.ok) {
          const hint =
            needsOAuth && res.status === 403
              ? `\nHint: the token may lack the required scopes (${op.scopes.join(", ")}). Re-run \`${LOGIN_COMMAND}\` with those scopes.`
              : "";
          return errorResult(`Etsy API ${res.status}: ${body}${hint}`);
        }
        return { content: [{ type: "text" as const, text: body }] };
      },
    );
  }

  return server;
}
