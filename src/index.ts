#!/usr/bin/env node
import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { parseLoginArgs, parseRedirectPort, runLogin } from "./login.js";
import { createServer } from "./server.js";
import { defaultConfigDir } from "./token-store.js";

function fail(err: unknown, code = 1): never {
  console.error(`etsy-mcp: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(code);
}

function openBrowser(url: string): Promise<void> {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

const [subcommand, ...rest] = process.argv.slice(2);

if (subcommand === "login") {
  try {
    const { scopes } = parseLoginArgs(rest);
    const apiKey = process.env.ETSY_API_KEY;
    if (!apiKey) throw new Error("ETSY_API_KEY environment variable is required");
    await runLogin(
      {
        apiKey,
        scopes,
        port: parseRedirectPort(process.env.ETSY_REDIRECT_PORT),
        configDir: defaultConfigDir(),
        seedRefreshToken: process.env.ETSY_REFRESH_TOKEN || undefined,
      },
      { fetch, openBrowser, log: (m) => console.error(m) },
    );
    console.error("Logged in. Tokens saved.");
  } catch (err) {
    fail(err);
  }
} else if (subcommand !== undefined) {
  fail(`Unknown command "${subcommand}". Run with no arguments to start the MCP server, or \`login [--scopes a,b]\`.`, 2);
} else {
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    fail(err);
  }
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
}
