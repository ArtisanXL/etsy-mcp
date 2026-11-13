import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { LOGIN_COMMAND, TokenError, TokenStore } from "./token-store.js";
import { operations } from "./generated/operations.js";
import type { OperationDescriptor, ParamDescriptor, PropertyDescriptor, ValueSchema } from "./operation.js";

export interface FetchInit {
  method?: OperationDescriptor["method"];
  headers: Record<string, string>;
  body?: string | FormData;
}
export type FetchLike = (url: URL, init: FetchInit) => Promise<Response>;

export interface ServerDeps {
  fetch?: FetchLike;
  now?: () => number;
  /** Waits between rate-limit retries (default setTimeout); tests inject it so they never wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides how upload files are read (default streams from disk); tests inject it. */
  readFile?: (path: string) => Promise<Uint8Array>;
}

const API_BASE = "https://openapi.etsy.com";
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry-After is delta-seconds or an HTTP date; absent or unparseable means the 1s default. */
function retryDelayMs(res: Response, now: number): number {
  const header = res.headers.get("retry-after")?.trim();
  if (!header) return DEFAULT_RETRY_MS;
  const ms = /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  if (Number.isNaN(ms)) return DEFAULT_RETRY_MS;
  return Math.min(Math.max(ms, 0), MAX_RETRY_MS);
}

export function valueSchema(v: ValueSchema): z.ZodType {
  const s = baseSchema(v);
  return v.nullable ? s.nullable() : s;
}

function baseSchema(v: ValueSchema): z.ZodType {
  if (v.type === "array") {
    return z.array(v.items ? valueSchema(v.items) : z.string());
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

function propertySchema(p: PropertyDescriptor, nonEmptyArray = false): z.ZodType {
  // An empty array in a query string would send nothing; body fields may legitimately clear a list.
  let s = nonEmptyArray && p.type === "array" ? (baseSchema(p) as z.ZodArray).min(1) : baseSchema(p);
  if (p.nullable) s = s.nullable();
  if (p.description) s = s.describe(p.description);
  return p.required ? s : s.optional();
}

function propertyShape(props: PropertyDescriptor[]): Record<string, z.ZodType> {
  return Object.fromEntries(props.map((p) => [p.name, propertySchema(p)]));
}

const FILE_FIELD_HINT = "Absolute local path of the file to upload; the server reads it from disk.";

function paramShape(params: ParamDescriptor[]): Record<string, z.ZodType> {
  return Object.fromEntries(
    params.map((p) => {
      const described =
        p.in === "body-multipart-file"
          ? { ...p, description: `${p.description ?? ""} ${FILE_FIELD_HINT}`.trim() }
          : p;
      return [p.name, propertySchema(described, p.in === "query")];
    }),
  );
}

function toolAnnotations(op: OperationDescriptor): ToolAnnotations {
  if (!op.write) return { readOnlyHint: true, openWorldHint: true };
  return {
    readOnlyHint: false,
    destructiveHint: op.method === "DELETE",
    idempotentHint: op.method === "PUT" || op.method === "DELETE",
    openWorldHint: true,
  };
}

const formValue = (v: unknown) => (Array.isArray(v) ? v.join(",") : String(v));

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain",
};

class UploadError extends Error {}

type OpenFile = (path: string, type: string) => Promise<Blob>;

const openFromDisk: OpenFile = async (path, type) => {
  if (!(await stat(path)).isFile()) throw new Error("not a regular file");
  return openAsBlob(path, { type });
};

async function readUpload(openFile: OpenFile, field: string, path: string) {
  if (!isAbsolute(path)) {
    throw new UploadError(
      `"${field}" must be an absolute local path, got "${path}". Relative paths and "~" are not expanded.`,
    );
  }
  const type = MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  try {
    return { blob: await openFile(path, type), filename: basename(path) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new UploadError(`Cannot read file for "${field}" at "${path}": ${reason}`);
  }
}

async function buildRequest(
  op: OperationDescriptor,
  args: Record<string, unknown>,
  openFile: OpenFile,
) {
  let path = op.path;
  const url = new URL(API_BASE);
  const form = new URLSearchParams();
  const json: Record<string, unknown> = {};
  const multipart = new FormData();
  for (const p of op.params) {
    const v = args[p.name];
    if (v === undefined) continue;
    if (v === null) {
      if (p.in === "body-json") json[p.name] = null;
      continue;
    }
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    else if (p.in === "query") url.searchParams.set(p.name, formValue(v));
    else if (p.in === "body-form") form.set(p.name, formValue(v));
    else if (p.in === "body-json") json[p.name] = v;
    else if (p.in === "body-multipart") multipart.append(p.name, formValue(v));
    else if (p.in === "body-multipart-file") {
      const { blob, filename } = await readUpload(openFile, p.name, String(v));
      multipart.append(p.name, blob, filename);
    }
  }
  url.pathname = path;
  if (op.params.some((p) => p.in === "body-form")) {
    return { url, contentType: "application/x-www-form-urlencoded", body: form.toString() };
  }
  if (op.params.some((p) => p.in === "body-json")) {
    return { url, contentType: "application/json", body: JSON.stringify(json) };
  }
  // No Content-Type for multipart: fetch sets it with the boundary.
  if (op.params.some((p) => p.in === "body-multipart" || p.in === "body-multipart-file")) {
    return { url, body: multipart };
  }
  return { url };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export function createServer(config: Config, deps: ServerDeps = {}): McpServer {
  const fetchImpl = deps.fetch ?? fetch;
  const { readFile } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const openFile: OpenFile = readFile
    ? async (path, type) => new Blob([(await readFile(path)) as Uint8Array<ArrayBuffer>], { type })
    : openFromDisk;
  const tokens = new TokenStore({
    configDir: config.configDir,
    apiKey: config.apiKey,
    seedRefreshToken: config.refreshToken,
    fetch: fetchImpl,
    now: deps.now,
  });
  const server = new McpServer({ name: "etsy-mcp", version: "0.1.1" });

  const enabled = config.toolsets && new Set<string>(config.toolsets);
  const offered = operations.filter((op) => (config.allowWrites || !op.write) && (!enabled || enabled.has(op.toolset)));
  for (const op of offered) {
    server.registerTool(
      op.toolName,
      { description: op.description, inputSchema: paramShape(op.params), annotations: toolAnnotations(op) },
      async (args: Record<string, unknown>) => {
        let built: Awaited<ReturnType<typeof buildRequest>>;
        try {
          built = await buildRequest(op, args, openFile);
        } catch (err) {
          if (err instanceof UploadError) return errorResult(err.message);
          throw err;
        }
        const { url, contentType, body: requestBody } = built;
        const send = (bearer?: string) => {
          const headers: Record<string, string> = { "x-api-key": `${config.apiKey}:${config.sharedSecret}` };
          if (bearer) headers.Authorization = `Bearer ${bearer}`;
          if (contentType) headers["Content-Type"] = contentType;
          return fetchImpl(url, { method: op.method, headers, body: requestBody });
        };
        // One budget per Tool call, shared across the 401 refresh retry, so a call never exceeds 3 rate-limit retries.
        let rateLimitRetries = 0;
        const sendLimited = async (bearer?: string) => {
          for (;;) {
            const res = await send(bearer);
            const dailyQuotaExhausted = res.headers.get("x-remaining-today") === "0";
            if (res.status !== 429 || dailyQuotaExhausted || rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) return res;
            rateLimitRetries++;
            await res.body?.cancel();
            await sleep(retryDelayMs(res, now()));
          }
        };
        const needsOAuth = op.oauth2;
        let res: Response;
        try {
          if (needsOAuth) {
            const token = await tokens.getAccessToken();
            res = await sendLimited(token);
            if (res.status === 401) {
              await res.body?.cancel();
              res = await sendLimited(await tokens.refreshAfterRejection(token));
            }
          } else {
            res = await sendLimited();
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
