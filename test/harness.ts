import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "../src/config.js";
import { createServer } from "../src/server.js";

export interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

export async function connect(
  config: Partial<Config> = {},
  respond: () => Response = () => new Response('{"ok":true}'),
) {
  const requests: RecordedRequest[] = [];
  const server = createServer(
    { apiKey: "key", sharedSecret: "secret", ...config },
    async (url, init) => {
      requests.push({ url, headers: init.headers });
      return respond();
    },
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, requests };
}
