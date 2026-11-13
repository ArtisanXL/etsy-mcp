import { createHash } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connect, tempConfigDir, TOKEN_ENDPOINT, type RecordedRequest } from "./harness.js";

const NOW = 1_700_000_000_000;
const now = () => NOW;
const RECEIPTS = { name: "get_shop_receipts", arguments: { shop_id: 1 } };

const isToken = (r: RecordedRequest) => r.url.href === TOKEN_ENDPOINT;
const tokenResponse = (access: string, refresh: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: expiresIn, token_type: "Bearer" }));

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

function seedFile(
  dir: string,
  tokens: { access_token: string; refresh_token: string; expires_at: number; seed_sha256?: string },
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "tokens.json"), JSON.stringify(tokens));
}
const readFileTokens = async (dir: string) => JSON.parse(await readFile(join(dir, "tokens.json"), "utf8"));

describe("Bearer on oauth2 Operations", () => {
  it("succeeds with only ETSY_REFRESH_TOKEN set", async () => {
    const { client, requests } = await connect(
      { refreshToken: "r1" },
      (req) => (isToken(req) ? tokenResponse("a1", "r1") : new Response('{"results":[]}')),
      { now },
    );
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: '{"results":[]}' }]);

    const [refresh, call] = requests;
    expect(refresh.method).toBe("POST");
    expect(new URLSearchParams(refresh.body)).toEqual(
      new URLSearchParams({ grant_type: "refresh_token", client_id: "key", refresh_token: "r1" }),
    );
    expect(call.url.pathname).toBe("/v3/application/shops/1/receipts");
    expect(call.headers.Authorization).toBe("Bearer a1");
    expect(call.headers["x-api-key"]).toBe("key:secret");
  });

  it("sends path parameters and pagination on an authenticated read", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "a", refresh_token: "r", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect({ configDir }, undefined, { now });
    await client.callTool({ name: "get_listings_by_shop", arguments: { shop_id: 3, limit: 1, offset: 2 } });
    expect(requests[0].url.href).toBe("https://openapi.etsy.com/v3/application/shops/3/listings?limit=1&offset=2");
    expect(requests[0].headers.Authorization).toBe("Bearer a");
  });

  it("uses a stored token that is still valid without refreshing", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "a-file", refresh_token: "r-file", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect({ configDir }, undefined, { now });
    await client.callTool(RECEIPTS);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.Authorization).toBe("Bearer a-file");
  });

  it("never loads, refreshes or requires a token for a public Operation", async () => {
    const configDir = join(tempConfigDir(), "missing");
    const { client, requests } = await connect({ configDir, refreshToken: "r1" }, undefined, { now });
    const res = await client.callTool({ name: "get_shop", arguments: { shop_id: 1 } });
    expect(res.isError).toBeFalsy();
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/v3/application/shops/1");
    expect(requests[0].headers.Authorization).toBeUndefined();
    expect(() => statSync(configDir)).toThrow();
  });
});

describe("refresh", () => {
  it("refreshes an expired token before the call and persists the rotated pair", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "old", refresh_token: "r-old", expires_at: NOW + 30_000 });
    const { client, requests } = await connect(
      { configDir },
      (req) => (isToken(req) ? tokenResponse("new", "r-new", 3600) : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    expect(requests.map((r) => r.method)).toEqual(["POST", "GET"]);
    expect(new URLSearchParams(requests[0].body).get("refresh_token")).toBe("r-old");
    expect(requests[1].headers.Authorization).toBe("Bearer new");
    expect(await readFileTokens(configDir)).toEqual({
      access_token: "new",
      refresh_token: "r-new",
      expires_at: NOW + 3_600_000,
    });
  });

  it("writes the token file with owner-only permissions", async () => {
    const configDir = join(tempConfigDir(), "nested");
    const { client } = await connect(
      { configDir, refreshToken: "r1" },
      (req) => (isToken(req) ? tokenResponse("a1", "r2") : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    expect(statSync(join(configDir, "tokens.json")).mode & 0o777).toBe(0o600);
    expect(statSync(configDir).mode & 0o777).toBe(0o700);
    expect((await readFileTokens(configDir)).refresh_token).toBe("r2");
  });

  it("tightens the permissions of a pre-existing loose token file", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "old", refresh_token: "r-old", expires_at: 0 });
    const { client } = await connect(
      { configDir },
      (req) => (isToken(req) ? tokenResponse("new", "r-new") : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    expect(statSync(join(configDir, "tokens.json")).mode & 0o777).toBe(0o600);
  });

  it("on 401 refreshes exactly once and retries", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "stale", refresh_token: "r1", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect(
      { configDir },
      (req) => {
        if (isToken(req)) return tokenResponse("fresh", "r2");
        return req.headers.Authorization === "Bearer fresh" ? new Response('{"ok":1}') : new Response("expired", { status: 401 });
      },
      { now },
    );
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBeFalsy();
    expect(requests.map((r) => `${r.method} ${r.headers.Authorization ?? ""}`)).toEqual([
      "GET Bearer stale",
      "POST ",
      "GET Bearer fresh",
    ]);
    expect((await readFileTokens(configDir)).access_token).toBe("fresh");
  });

  it("does not loop when the retry is also rejected", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "stale", refresh_token: "r1", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect(
      { configDir },
      (req) => (isToken(req) ? tokenResponse("fresh", "r2") : new Response("nope", { status: 401 })),
      { now },
    );
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Etsy API 401: nope");
    expect(requests.filter(isToken)).toHaveLength(1);
    expect(requests).toHaveLength(3);
  });

  it("two concurrent calls cause one refresh", async () => {
    const { client, requests } = await connect(
      { refreshToken: "r1" },
      async (req) => {
        if (isToken(req)) {
          await new Promise((r) => setTimeout(r, 20));
          return tokenResponse("a1", "r2");
        }
        return new Response("{}");
      },
      { now },
    );
    const [a, b] = await Promise.all([client.callTool(RECEIPTS), client.callTool(RECEIPTS)]);
    expect(a.isError).toBeFalsy();
    expect(b.isError).toBeFalsy();
    expect(requests.filter(isToken)).toHaveLength(1);
    const calls = requests.filter((r) => !isToken(r));
    expect(calls).toHaveLength(2);
    expect(calls.every((r) => r.headers.Authorization === "Bearer a1")).toBe(true);
  });

  it("two concurrent 401s cause one refresh", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "stale", refresh_token: "r1", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect(
      { configDir },
      async (req) => {
        if (isToken(req)) {
          await new Promise((r) => setTimeout(r, 20));
          return tokenResponse("fresh", "r2");
        }
        return req.headers.Authorization === "Bearer fresh" ? new Response("{}") : new Response("x", { status: 401 });
      },
      { now },
    );
    const results = await Promise.all([client.callTool(RECEIPTS), client.callTool(RECEIPTS)]);
    expect(results.every((r) => !r.isError)).toBe(true);
    expect(requests.filter(isToken)).toHaveLength(1);
  });

  it("ETSY_REFRESH_TOKEN seeds the store when the file holds a different refresh token", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "file-access", refresh_token: "r-file", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect(
      { configDir, refreshToken: "r-env" },
      (req) => (isToken(req) ? tokenResponse("env-access", "r-env2") : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    await client.callTool(RECEIPTS);
    expect(new URLSearchParams(requests[0].body).get("refresh_token")).toBe("r-env");
    expect(requests.filter(isToken)).toHaveLength(1);
    expect(requests.at(-1)!.headers.Authorization).toBe("Bearer env-access");
  });

  it("a stale ETSY_REFRESH_TOKEN does not overwrite a rotated token it already seeded", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "old", refresh_token: "r2", expires_at: 0, seed_sha256: sha("r1") });
    const { client, requests } = await connect(
      { configDir, refreshToken: "r1" },
      (req) => (isToken(req) ? tokenResponse("a3", "r3") : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    expect(new URLSearchParams(requests[0].body).get("refresh_token")).toBe("r2");
    expect(await readFileTokens(configDir)).toMatchObject({ refresh_token: "r3", seed_sha256: sha("r1") });
  });

  it("records a hash (never the raw token) of the seed, and keeps it across rotations", async () => {
    const configDir = tempConfigDir();
    const respond = (req: RecordedRequest) =>
      isToken(req) ? tokenResponse("a", `r-${requestsCount++}`, 0) : new Response("{}");
    let requestsCount = 0;
    const first = await connect({ configDir, refreshToken: "r1" }, respond, { now });
    await first.client.callTool(RECEIPTS);
    await first.client.callTool(RECEIPTS);
    const file = await readFileTokens(configDir);
    expect(file.seed_sha256).toBe(sha("r1"));
    expect(JSON.stringify(file)).not.toContain('"r1"');

    const second = await connect({ configDir, refreshToken: "r1" }, respond, { now });
    await second.client.callTool(RECEIPTS);
    expect(new URLSearchParams(second.requests[0].body).get("refresh_token")).toBe(file.refresh_token);
  });

  it("a new ETSY_REFRESH_TOKEN value re-seeds an already-seeded file", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "x", refresh_token: "r2", expires_at: NOW + 3_600_000, seed_sha256: sha("r1") });
    const { client, requests } = await connect(
      { configDir, refreshToken: "r-new" },
      (req) => (isToken(req) ? tokenResponse("a", "b") : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    expect(new URLSearchParams(requests[0].body).get("refresh_token")).toBe("r-new");
  });

  it("a file whose refresh token equals the env value is remembered as seeded across a rotation", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "x", refresh_token: "r1", expires_at: 0 });
    const { client } = await connect(
      { configDir, refreshToken: "r1" },
      (req) => (isToken(req) ? tokenResponse("a", "r2") : new Response("{}")),
      { now },
    );
    await client.callTool(RECEIPTS);
    expect(await readFileTokens(configDir)).toMatchObject({ refresh_token: "r2", seed_sha256: sha("r1") });
  });

  it("ETSY_REFRESH_TOKEN equal to the file's refresh token keeps the stored access token", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "file-access", refresh_token: "r1", expires_at: NOW + 3_600_000 });
    const { client, requests } = await connect({ configDir, refreshToken: "r1" }, undefined, { now });
    await client.callTool(RECEIPTS);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.Authorization).toBe("Bearer file-access");
  });
});

describe("auth errors", () => {
  it("tells the user to run login when no token is available", async () => {
    const { client, requests } = await connect({ configDir: join(tempConfigDir(), "none") }, undefined, { now });
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/Run `npx @artisanxl\/etsy-mcp login`/);
    expect(requests).toHaveLength(0);
  });

  it.each(["{not json", "null", '{"access_token":"a"}'])("reports a malformed token file (%s) with a login hint", async (raw) => {
    const configDir = tempConfigDir();
    writeFileSync(join(configDir, "tokens.json"), raw);
    const { client, requests } = await connect({ configDir }, undefined, { now });
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/malformed.*login/);
    expect(requests).toHaveLength(0);
  });

  it("does not echo an invalid refresh response (it may contain tokens)", async () => {
    const { client } = await connect(
      { refreshToken: "r1" },
      (req) => (isToken(req) ? new Response('{"access_token":"SECRET-ACCESS","expires_in":"soon"}') : new Response("{}")),
      { now },
    );
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("expires_in");
    expect(text).not.toContain("SECRET-ACCESS");
  });

  it("surfaces a failed refresh with a login hint", async () => {
    const { client } = await connect(
      { refreshToken: "bad" },
      (req) => (isToken(req) ? new Response('{"error":"invalid_grant"}', { status: 400 }) : new Response("{}")),
      { now },
    );
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("400");
    expect(text).toContain("invalid_grant");
    expect(text).toMatch(/login/);
  });

  it("hints at login with the needed scopes on 403", async () => {
    const configDir = tempConfigDir();
    seedFile(configDir, { access_token: "a", refresh_token: "r", expires_at: NOW + 3_600_000 });
    const { client } = await connect({ configDir }, () => new Response("forbidden", { status: 403 }), { now });
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("Etsy API 403: forbidden");
    expect(text).toMatch(/login/);
    expect(text).toContain("transactions_r");
  });

  it("does not add a login hint to a 403 on a public Operation", async () => {
    const { client } = await connect({}, () => new Response("forbidden", { status: 403 }));
    const res = await client.callTool({ name: "get_shop", arguments: { shop_id: 1 } });
    expect(JSON.stringify(res.content)).not.toMatch(/login/);
  });
});
