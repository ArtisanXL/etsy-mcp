import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allScopes, parseLoginArgs, parseRedirectPort, runLogin, type LoginOptions } from "../src/login.js";
import { connect, tempConfigDir, TOKEN_ENDPOINT, type RecordedRequest } from "./harness.js";

const NOW = 1_700_000_000_000;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

function setup(opts: Partial<LoginOptions> = {}, visit?: (authorize: URL) => Promise<void>) {
  const configDir = tempConfigDir();
  const opened: URL[] = [];
  const requests: RecordedRequest[] = [];
  const promise = runLogin(
    { apiKey: "key", port: 0, configDir, ...opts },
    {
      now: () => NOW,
      timeoutMs: 5_000,
      openBrowser: async (url) => {
        const u = new URL(url);
        opened.push(u);
        await visit?.(u);
      },
      fetch: async (url, init) => {
        requests.push({ method: init.method, url, headers: init.headers, body: init.body });
        return new Response(JSON.stringify({ access_token: "acc", refresh_token: "ref", expires_in: 3600, token_type: "Bearer" }));
      },
    },
  );
  return { configDir, opened, requests, promise };
}

const callback = (authorize: URL, params: Record<string, string>) => {
  const url = new URL(authorize.searchParams.get("redirect_uri")!);
  url.search = new URLSearchParams(params).toString();
  return fetch(url);
};
const goodCallback = (a: URL) => callback(a, { code: "the-code", state: a.searchParams.get("state")! }).then(() => {});

describe("authorize URL", () => {
  it("carries client id, every scope by default, S256 challenge and state", async () => {
    const { opened, promise } = setup({}, goodCallback);
    await promise;
    const u = opened[0];
    expect(u.origin + u.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("key");
    expect(u.searchParams.get("scope")!.split(" ")).toEqual(allScopes());
    expect(allScopes()).toContain("listings_w");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+\/callback$/);
  });

  it("--scopes narrows the requested scopes", async () => {
    const { scopes } = parseLoginArgs(["--scopes", "listings_r, shops_r"]);
    expect(scopes).toEqual(["listings_r", "shops_r"]);
    expect(parseLoginArgs(["--scopes=email_r"]).scopes).toEqual(["email_r"]);
    const { opened, promise } = setup({ scopes }, goodCallback);
    await promise;
    expect(opened[0].searchParams.get("scope")).toBe("listings_r shops_r");
    expect(opened[0].href).toContain("scope=listings_r%20shops_r");
  });

  it("rejects malformed --scopes and unknown arguments", () => {
    expect(() => parseLoginArgs(["--scopes"])).toThrow(/requires/);
    expect(() => parseLoginArgs(["--scopes", "listings_r,,shops_r"])).toThrow(/empty entry/);
    expect(() => parseLoginArgs(["--scopes", "listing_r"])).toThrow(/Unknown scope.*"listing_r".*listings_r/);
    expect(() => parseLoginArgs(["--bogus"])).toThrow(/Unknown argument/);
    expect(parseLoginArgs([]).scopes).toBeUndefined();
  });
});

describe("callback", () => {
  it("rejects a wrong state, keeps waiting, and still completes on the right one", async () => {
    let wrongStatus = 0;
    const { requests, promise } = setup({}, async (a) => {
      wrongStatus = (await callback(a, { code: "evil", state: "forged" })).status;
      expect(requests).toHaveLength(0);
      await goodCallback(a);
    });
    await promise;
    expect(wrongStatus).toBe(400);
    expect(new URLSearchParams(requests[0].body).get("code")).toBe("the-code");
  });

  it("exchanges the code with the PKCE verifier and writes owner-only tokens", async () => {
    const { configDir, opened, requests, promise } = setup({}, goodCallback);
    const pair = await promise;
    expect(requests).toHaveLength(1);
    expect(requests[0].url.href).toBe(TOKEN_ENDPOINT);
    expect(requests[0].method).toBe("POST");
    const form = new URLSearchParams(requests[0].body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe("key");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("redirect_uri")).toBe(opened[0].searchParams.get("redirect_uri"));
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(
      opened[0].searchParams.get("code_challenge"),
    );

    expect(pair).toEqual({ access_token: "acc", refresh_token: "ref", expires_at: NOW + 3_600_000 });
    const file = join(configDir, "tokens.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(pair);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("fails without exchanging when Etsy reports an error with the right state", async () => {
    const { requests, promise } = setup({}, async (a) => {
      await callback(a, { error: "access_denied", state: a.searchParams.get("state")! });
    });
    await expect(promise).rejects.toThrow(/access_denied/);
    expect(requests).toHaveLength(0);
  });

  it("surfaces a failed token exchange without writing tokens", async () => {
    const configDir = tempConfigDir();
    await expect(
      runLogin(
        { apiKey: "key", port: 0, configDir },
        {
          openBrowser: goodCallbackOpener,
          fetch: async () => new Response("nope", { status: 400 }),
        },
      ),
    ).rejects.toThrow(/token exchange failed \(400\)/);
    expect(() => statSync(join(configDir, "tokens.json"))).toThrow();
  });

  it("times out when no callback arrives", async () => {
    const promise = runLogin(
      { apiKey: "key", port: 0, configDir: tempConfigDir() },
      { openBrowser: () => {}, fetch: async () => new Response(""), timeoutMs: 50 },
    );
    await expect(promise).rejects.toThrow(/Timed out/);
  });
});

function goodCallbackOpener(url: string) {
  return goodCallback(new URL(url));
}

describe("seed_sha256 after login", () => {
  it("records the env refresh token as already seeded so it does not clobber the login", async () => {
    const { configDir, promise } = setup({ seedRefreshToken: "stale-env" }, goodCallback);
    await promise;
    const saved = JSON.parse(await readFile(join(configDir, "tokens.json"), "utf8"));
    expect(saved.seed_sha256).toBe(sha("stale-env"));
    expect(JSON.stringify(saved)).not.toContain("stale-env");

    // Server start with the same ETSY_REFRESH_TOKEN uses the login tokens, not the env value.
    const { client, requests } = await connect(
      { configDir, refreshToken: "stale-env" },
      () => new Response("{}"),
      { now: () => NOW },
    );
    await client.callTool({ name: "get_shop_receipts", arguments: { shop_id: 1 } });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.Authorization).toBe("Bearer acc");
  });

  it("an unmarked login result wins over an ETSY_REFRESH_TOKEN set only on the server", async () => {
    const { configDir, promise } = setup({}, goodCallback);
    await promise;
    const { client, requests } = await connect(
      { configDir, refreshToken: "mcp-env" },
      () => new Response("{}"),
      { now: () => NOW },
    );
    await client.callTool({ name: "get_shop_receipts", arguments: { shop_id: 1 } });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.Authorization).toBe("Bearer acc");
  });

  it("omits seed_sha256 when there is nothing to remember", async () => {
    const { configDir, promise } = setup({}, goodCallback);
    await promise;
    expect(JSON.parse(await readFile(join(configDir, "tokens.json"), "utf8"))).not.toHaveProperty("seed_sha256");
  });
});

describe("ETSY_REDIRECT_PORT", () => {
  it("defaults to 3003 and validates", () => {
    expect(parseRedirectPort(undefined)).toBe(3003);
    expect(parseRedirectPort("4000")).toBe(4000);
    expect(() => parseRedirectPort("abc")).toThrow(/ETSY_REDIRECT_PORT/);
    expect(() => parseRedirectPort("0")).toThrow(/ETSY_REDIRECT_PORT/);
    expect(() => parseRedirectPort("70000")).toThrow(/ETSY_REDIRECT_PORT/);
  });

  it("reports a port already in use", async () => {
    const { createServer } = await import("node:net");
    const blocker = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => blocker.once("listening", r));
    const port = (blocker.address() as import("node:net").AddressInfo).port;
    try {
      await expect(
        runLogin({ apiKey: "key", port, configDir: tempConfigDir() }, { openBrowser: () => {}, fetch: async () => new Response("") }),
      ).rejects.toThrow(/already in use/);
    } finally {
      blocker.close();
    }
  });
});
