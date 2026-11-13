#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createServer } from "./server.js";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`etsy-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = createServer(config);
await server.connect(new StdioServerTransport());
