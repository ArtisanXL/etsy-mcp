import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "../src/config.js";
import { createServer, type ServerDeps } from "../src/server.js";

export interface RecordedRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
  /** Set instead of `body` for multipart requests. */
  form?: FormData;
}

export const TOKEN_ENDPOINT = "https://openapi.etsy.com/v3/public/oauth/token";

export function tempConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "etsy-mcp-test-"));
}

export async function connect(
  config: Partial<Config> = {},
  respond: (req: RecordedRequest) => Response | Promise<Response> = () => new Response('{"ok":true}'),
  deps: Omit<ServerDeps, "fetch"> = {},
) {
  const requests: RecordedRequest[] = [];
  const configDir = config.configDir ?? tempConfigDir();
  const server = createServer(
    { apiKey: "key", sharedSecret: "secret", allowWrites: false, ...config, configDir },
    {
      ...deps,
      fetch: async (url, init) => {
        const req = { method: init.method ?? "GET", url, headers: init.headers, body: typeof init.body === "string" ? init.body : undefined,
          form: init.body instanceof FormData ? init.body : undefined,
        };
        requests.push(req);
        return respond(req);
      },
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, requests, configDir };
}
