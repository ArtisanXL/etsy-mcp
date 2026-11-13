import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { operations } from "./generated/operations.js";
import { TOKEN_URL, writeTokens, type TokenFetch, type TokenPair } from "./token-store.js";

export const AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
export const DEFAULT_REDIRECT_PORT = 3003;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Every scope required by any Operation, sorted. */
export function allScopes(): string[] {
  return [...new Set(operations.flatMap((o) => o.scopes))].sort();
}

export interface LoginArgs {
  scopes?: string[];
}

export function parseLoginArgs(args: string[]): LoginArgs {
  let scopes: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value: string | undefined;
    if (arg === "--scopes") {
      value = args[++i];
      if (value === undefined) throw new Error("--scopes requires a comma-separated list, e.g. --scopes listings_r,shops_r");
    } else if (arg.startsWith("--scopes=")) {
      value = arg.slice("--scopes=".length);
    } else {
      throw new Error(`Unknown argument for login: ${arg}. Usage: login [--scopes a,b]`);
    }
    const list = value.split(",").map((s) => s.trim());
    const valid = allScopes();
    const bad = list.filter((s) => !valid.includes(s));
    if (bad.length > 0) {
      const shown = bad.map((s) => (s === "" ? "(empty entry)" : `"${s}"`)).join(", ");
      throw new Error(`Unknown scope in --scopes: ${shown}. Valid scopes: ${valid.join(", ")}`);
    }
    scopes = [...new Set(list)];
  }
  return { scopes };
}

export function parseRedirectPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_REDIRECT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ETSY_REDIRECT_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

export interface LoginOptions {
  apiKey: string;
  /** Defaults to every scope used by any Operation. */
  scopes?: string[];
  /** Port for the one-shot callback server; 0 picks a free one. */
  port: number;
  configDir: string;
  /** The ETSY_REFRESH_TOKEN currently in the environment, if any (see seed_sha256 handling in login). */
  seedRefreshToken?: string;
}

export interface LoginDeps {
  fetch: TokenFetch;
  openBrowser: (url: string) => void | Promise<void>;
  log?: (message: string) => void;
  now?: () => number;
  timeoutMs?: number;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const base64url = (b: Buffer) => b.toString("base64url");

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p>${body}</p>`;

export async function runLogin(opts: LoginOptions, deps: LoginDeps): Promise<TokenPair> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const scopes = opts.scopes ?? allScopes();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  let finish!: (r: { code: string } | { error: string }) => void;
  const outcome = new Promise<{ code: string } | { error: string }>((resolve) => (finish = resolve));

  const http: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    // A mismatched state is rejected without ending the flow, so a forged request cannot abort a real login.
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400, { "content-type": "text/html" }).end(page("Login rejected", "The state value did not match."));
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error || !code) {
      const detail = error ? `${error}${url.searchParams.get("error_description") ? `: ${url.searchParams.get("error_description")}` : ""}` : "no code returned";
      res.writeHead(400, { "content-type": "text/html" }).end(page("Login failed", "Authorization was not granted. You can close this tab."));
      finish({ error: detail });
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(page("Logged in", "Etsy authorization complete. You can close this tab."));
    finish({ code });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, "127.0.0.1", () => resolve());
  }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      throw new Error(`Port ${opts.port} is already in use. Free it or set ETSY_REDIRECT_PORT (it must match the redirect URI registered in your Etsy app).`);
    }
    throw err;
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    const port = (http.address() as AddressInfo).port;
    const redirectUri = `http://localhost:${port}/callback`;
    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: opts.apiKey,
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })
      .toString()
      .replace(/\+/g, "%20");

    log(`Open this URL in your browser to authorize (redirect URI: ${redirectUri}):\n${authorizeUrl.href}`);
    try {
      await deps.openBrowser(authorizeUrl.href);
    } catch {
      log("Could not open a browser automatically; open the URL above manually.");
    }

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for the Etsy authorization callback.")), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
    const result = await Promise.race([outcome, timeout]);
    if ("error" in result) throw new Error(`Etsy authorization failed: ${result.error}`);

    const res = await deps.fetch(new URL(TOKEN_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: opts.apiKey,
        redirect_uri: redirectUri,
        code: result.code,
        code_verifier: verifier,
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Etsy token exchange failed (${res.status}): ${text}`);
    let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } = {};
    try {
      body = JSON.parse(text);
    } catch {}
    if (
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string" ||
      typeof body.expires_in !== "number"
    ) {
      throw new Error("Etsy token exchange returned an unexpected response: expected access_token, refresh_token and expires_in.");
    }

    // Recording the env refresh token as already seeded keeps a stale ETSY_REFRESH_TOKEN from clobbering this
    // login on the next server start. Without an env value the file stays unmarked, which also wins over env.
    const seed_sha256 = opts.seedRefreshToken ? sha256(opts.seedRefreshToken) : undefined;
    const pair: TokenPair = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: now() + body.expires_in * 1000,
      ...(seed_sha256 ? { seed_sha256 } : {}),
    };
    await writeTokens(opts.configDir, pair);
    return pair;
  } finally {
    clearTimeout(timer);
    http.close();
    http.closeAllConnections();
  }
}
