import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const TOKEN_URL = "https://openapi.etsy.com/v3/public/oauth/token";
export const LOGIN_COMMAND = "npx @artisanxl/etsy-mcp login";

/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;

/** Persisted shape; `expires_at` is epoch milliseconds. */
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  /**
   * sha256 (hex) of the ETSY_REFRESH_TOKEN value that seeded this file; never the raw token.
   * Lets a later start tell "env is the token I already consumed" from "env is a new token".
   */
  seed_sha256?: string;
}

export interface TokenFetchInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}
export type TokenFetch = (url: URL, init: TokenFetchInit) => Promise<Response>;

export interface TokenStoreOptions {
  configDir: string;
  apiKey: string;
  /** From ETSY_REFRESH_TOKEN; seeds the store when the file is absent or was seeded from a different value; an unmarked file (e.g. from `login`) wins. */
  seedRefreshToken?: string;
  fetch: TokenFetch;
  now?: () => number;
}

/** An error whose message is safe and useful to show to the agent as-is. */
export class TokenError extends Error {}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function defaultConfigDir(): string {
  return join(homedir(), ".config", "etsy-mcp");
}

export function tokenFilePath(configDir: string): string {
  return join(configDir, "tokens.json");
}

export async function readTokens(configDir: string): Promise<TokenPair | undefined> {
  let raw: string;
  try {
    raw = await readFile(tokenFilePath(configDir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const malformed = new TokenError(`${tokenFilePath(configDir)} is malformed. Run \`${LOGIN_COMMAND}\` to recreate it.`);
  let t: Partial<TokenPair> | null;
  try {
    t = JSON.parse(raw);
  } catch {
    throw malformed;
  }
  if (
    !t ||
    typeof t.access_token !== "string" ||
    typeof t.refresh_token !== "string" ||
    typeof t.expires_at !== "number"
  ) {
    throw malformed;
  }
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: t.expires_at,
    ...(typeof t.seed_sha256 === "string" ? { seed_sha256: t.seed_sha256 } : {}),
  };
}

export async function writeTokens(configDir: string, tokens: TokenPair): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  const file = tokenFilePath(configDir);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(tokens, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

export class TokenStore {
  readonly #opts: TokenStoreOptions;
  readonly #now: () => number;
  #lock: Promise<unknown> = Promise.resolve();

  constructor(opts: TokenStoreOptions) {
    this.#opts = opts;
    this.#now = opts.now ?? Date.now;
  }

  /** A usable access token, refreshing first if it is missing or about to expire. */
  getAccessToken(): Promise<string> {
    return this.#exclusive(async () => {
      const current = await this.#load();
      if (current && this.#isFresh(current)) return current.access_token;
      return (await this.#refresh(current)).access_token;
    });
  }

  /** After a 401: a token other than `rejected`, refreshing only if nobody else already has. */
  refreshAfterRejection(rejected: string): Promise<string> {
    return this.#exclusive(async () => {
      const current = await this.#load();
      if (current && current.access_token !== rejected && this.#isFresh(current)) return current.access_token;
      return (await this.#refresh(current)).access_token;
    });
  }

  // Serializing resolution means concurrent callers share one refresh: later callers see the fresh pair.
  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn);
    this.#lock = run.catch(() => undefined);
    return run;
  }

  #isFresh(t: TokenPair): boolean {
    return t.access_token !== "" && t.expires_at - EXPIRY_MARGIN_MS > this.#now();
  }

  async #load(): Promise<TokenPair | undefined> {
    const stored = await readTokens(this.#opts.configDir);
    const seed = this.#opts.seedRefreshToken;
    if (!seed) return stored;
    const seedHash = sha256(seed);
    if (!stored) return { access_token: "", refresh_token: seed, expires_at: 0, seed_sha256: seedHash };
    if (stored.seed_sha256 === seedHash) return stored;
    if (stored.seed_sha256 === undefined) {
      // An unmarked file is a `login` result (or the file already holds this token): it wins over the env
      // value. Mark it as seeded so a later rotation is not overwritten by the stale env value on restart.
      const marked = { ...stored, seed_sha256: seedHash };
      await writeTokens(this.#opts.configDir, marked);
      return marked;
    }
    return { access_token: "", refresh_token: seed, expires_at: 0, seed_sha256: seedHash };
  }

  async #refresh(current: TokenPair | undefined): Promise<TokenPair> {
    if (!current) {
      throw new TokenError(
        `No Etsy OAuth token available. Run \`${LOGIN_COMMAND}\` to authorize, or set ETSY_REFRESH_TOKEN.`,
      );
    }
    const res = await this.#opts.fetch(new URL(TOKEN_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: this.#opts.apiKey,
        refresh_token: current.refresh_token,
      }).toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new TokenError(
        `Etsy token refresh failed (${res.status}): ${text}. Run \`${LOGIN_COMMAND}\` to authorize again.`,
      );
    }
    let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new TokenError(
        "Etsy token refresh returned an unexpected response: missing or invalid " +
          [
            typeof body.access_token !== "string" && "access_token",
            typeof body.expires_in !== "number" && "expires_in",
          ]
            .filter(Boolean)
            .join(", "),
      );
    }
    const pair: TokenPair = {
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : current.refresh_token,
      expires_at: this.#now() + body.expires_in * 1000,
      ...(current.seed_sha256 ? { seed_sha256: current.seed_sha256 } : {}),
    };
    await writeTokens(this.#opts.configDir, pair);
    return pair;
  }
}
