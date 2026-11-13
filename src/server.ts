import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { LOGIN_COMMAND, TokenError, TokenStore } from "./token-store.js";
import { operations } from "./generated/operations.js";
import type { OperationDescriptor, PropertyDescriptor, ValueSchema } from "./operation.js";

export interface FetchInit {
  method?: OperationDescriptor["method"];
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
  if (v.type === "object") {
    return v.properties ? z.object(propertyShape(v.properties)) : z.record(z.string(), z.unknown());
  }
  if (v.enum) return z.enum(v.enum as [string, ...string[]]);
  return z.string();
}

function propertySchema(p: PropertyDescriptor): z.ZodType {
  let s = valueSchema(p);
  if (p.description) s = s.describe(p.description);
  return p.required ? s : s.optional();
}

function propertyShape(props: PropertyDescriptor[]): Record<string, z.ZodType> {
  return Object.fromEntries(props.map((p) => [p.name, propertySchema(p)]));
}

export function toolAnnotations(op: OperationDescriptor): ToolAnnotations {
  if (!op.write) return { readOnlyHint: true, openWorldHint: true };
  return {
    readOnlyHint: false,
    destructiveHint: op.method === "DELETE",
    idempotentHint: op.method === "PUT" || op.method === "DELETE",
    openWorldHint: true,
  };
}

const formValue = (v: unknown) => (Array.isArray(v) ? v.join(",") : String(v));

function buildRequest(op: OperationDescriptor, args: Record<string, unknown>) {
  let path = op.path;
  const url = new URL(API_BASE);
  const form = new URLSearchParams();
  const json: Record<string, unknown> = {};
  for (const p of op.params) {
    const v = args[p.name];
    if (v === undefined) continue;
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    else if (p.in === "query") url.searchParams.set(p.name, formValue(v));
    else if (p.in === "body-form") form.set(p.name, formValue(v));
    else if (p.in === "body-json") json[p.name] = v;
  }
  url.pathname = path;
  if (op.params.some((p) => p.in === "body-form")) {
    return { url, contentType: "application/x-www-form-urlencoded", body: form.toString() };
  }
  if (op.params.some((p) => p.in === "body-json")) {
    return { url, contentType: "application/json", body: JSON.stringify(json) };
  }
  return { url };
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
  const offered = operations.filter(
    (op) =>
      (config.allowWrites || !op.write) &&
      (!enabled || enabled.has(op.toolset)) &&
      !op.params.some((p) => p.in === "body-multipart" || p.in === "body-multipart-file"),
  );
  for (const op of offered) {
    server.registerTool(
      op.toolName,
      { description: op.description, inputSchema: propertyShape(op.params), annotations: toolAnnotations(op) },
      async (args: Record<string, unknown>) => {
        const { url, contentType, body: requestBody } = buildRequest(op, args);
        const send = (bearer?: string) => {
          const headers: Record<string, string> = { "x-api-key": `${config.apiKey}:${config.sharedSecret}` };
          if (bearer) headers.Authorization = `Bearer ${bearer}`;
          if (contentType) headers["Content-Type"] = contentType;
          return fetchImpl(url, { method: op.method, headers, body: requestBody });
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
