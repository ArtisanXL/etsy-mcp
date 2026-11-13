import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { connect, tempConfigDir, TOKEN_ENDPOINT, type RecordedRequest } from "./harness.js";

const NOW = 1_700_000_000_000;
const now = () => NOW;
const SHOP = { name: "get_shop", arguments: { shop_id: 1 } };
const RECEIPTS = { name: "get_shop_receipts", arguments: { shop_id: 1 } };

const limited = (headers: Record<string, string> = {}) => new Response("slow down", { status: 429, headers });

function setup(respond: (req: RecordedRequest, call: number) => Response | Promise<Response>, config = {}) {
  const sleeps: number[] = [];
  let call = 0;
  return {
    sleeps,
    connected: connect(config, (req) => respond(req, ++call), {
      now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    }),
  };
}

function seedStale() {
  const configDir = tempConfigDir();
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "tokens.json"),
    JSON.stringify({ access_token: "stale", refresh_token: "r1", expires_at: NOW + 3_600_000 }),
  );
  return configDir;
}
const tokenResponse = () =>
  new Response(JSON.stringify({ access_token: "fresh", refresh_token: "r2", expires_in: 3600, token_type: "Bearer" }));
const isToken = (r: RecordedRequest) => r.url.href === TOKEN_ENDPOINT;

describe("429 rate limiting", () => {
  it("retries after Retry-After seconds and succeeds on the next attempt", async () => {
    const { sleeps, connected } = setup((_, n) => (n === 1 ? limited({ "retry-after": "2" }) : new Response('{"ok":true}')));
    const { client, requests } = await connected;
    const res = await client.callTool(SHOP);
    expect(res.isError).toBeFalsy();
    expect(res.content).toEqual([{ type: "text", text: '{"ok":true}' }]);
    expect(requests).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("defaults to 1s when Retry-After is absent or unparseable", async () => {
    const { sleeps, connected } = setup((_, n) =>
      n === 1 ? limited() : n === 2 ? limited({ "retry-after": "soon" }) : new Response("{}"),
    );
    const { client } = await connected;
    await client.callTool(SHOP);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("treats a Retry-After beyond 60s as quota exhaustion and returns it immediately", async () => {
    const { sleeps, connected } = setup(() => limited({ "retry-after": "3600" }));
    const { client, requests } = await connected;
    const res = await client.callTool(SHOP);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Daily Etsy API quota exhausted");
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("still retries a Retry-After of exactly 60s", async () => {
    const { sleeps, connected } = setup((_, n) => (n === 1 ? limited({ "retry-after": "60" }) : new Response("{}")));
    const { client } = await connected;
    await client.callTool(SHOP);
    expect(sleeps).toEqual([60_000]);
  });

  it.each(["-5", "1e3", "nonsense!"])("falls back to the 1s default for Retry-After %j", async (value) => {
    const { sleeps, connected } = setup((_, n) => (n === 1 ? limited({ "retry-after": value }) : new Response("{}")));
    const { client } = await connected;
    await client.callTool(SHOP);
    expect(sleeps).toEqual([1000]);
  });

  it("honors an HTTP-date Retry-After", async () => {
    const date = new Date(NOW + 5000).toUTCString();
    const { sleeps, connected } = setup((_, n) => (n === 1 ? limited({ "retry-after": date }) : new Response("{}")));
    const { client } = await connected;
    await client.callTool(SHOP);
    expect(sleeps).toEqual([5000]);
  });

  it("gives up with an error after 3 retries on 4 consecutive 429s", async () => {
    const { sleeps, connected } = setup(() => limited({ "retry-after": "1" }));
    const { client, requests } = await connected;
    const res = await client.callTool(SHOP);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Etsy API 429: slow down");
    expect(JSON.stringify(res.content)).toContain("gave up after 3 retries");
    expect(requests).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it("returns a daily-quota 429 immediately without retrying", async () => {
    const { sleeps, connected } = setup(() => limited({ "x-remaining-today": "0", "retry-after": "1" }));
    const { client, requests } = await connected;
    const res = await client.callTool(SHOP);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Etsy API 429");
    expect(JSON.stringify(res.content)).toContain("Daily Etsy API quota exhausted");
    expect(requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries a 429 that still has daily quota left", async () => {
    const { connected } = setup((_, n) => (n === 1 ? limited({ "x-remaining-today": "100" }) : new Response("{}")));
    const { client, requests } = await connected;
    expect((await client.callTool(SHOP)).isError).toBeFalsy();
    expect(requests).toHaveLength(2);
  });

  it("re-sends a write body unchanged on retry", async () => {
    const { connected } = setup((_, n) => (n === 1 ? limited() : new Response("{}")), {
      allowWrites: true,
      configDir: seedStale(),
    });
    const { client, requests } = await connected;
    const res = await client.callTool({ name: "update_listing", arguments: { shop_id: 1, listing_id: 2, title: "t" } });
    expect(res.isError).toBeFalsy();
    expect(requests.map((r) => `${r.method} ${r.body}`)).toEqual(["PATCH title=t", "PATCH title=t"]);
  });
});

describe("cancellation", () => {
  it("aborts the wait and stops retrying when the MCP request is cancelled", async () => {
    let sleepSignal: AbortSignal | undefined;
    let sleepStarted!: () => void;
    const started = new Promise<void>((r) => (sleepStarted = r));
    let sleepEnded = false;
    const { client, requests } = await connect({}, () => limited(), {
      now,
      sleep: (_ms, signal) => {
        sleepSignal = signal;
        sleepStarted();
        return new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => {
            sleepEnded = true;
            resolve();
          }),
        );
      },
    });
    const controller = new AbortController();
    const call = client.callTool(SHOP, undefined, { signal: controller.signal });
    call.catch(() => {});
    await started;
    expect(requests).toHaveLength(1);
    controller.abort();
    await expect(call).rejects.toBeDefined();
    await vi.waitFor(() => expect(sleepEnded).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(sleepSignal?.aborted).toBe(true);
    expect(requests).toHaveLength(1);
  });
});

describe("429 composed with 401 refresh", () => {
  it("a 429 does not consume the single 401 refresh (429, 401, then success)", async () => {
    const { sleeps, connected } = setup(
      (req, n) => {
        if (isToken(req)) return tokenResponse();
        if (req.headers.Authorization === "Bearer fresh") return new Response('{"ok":1}');
        return n === 1 ? limited() : new Response("expired", { status: 401 });
      },
      { configDir: seedStale() },
    );
    const { client, requests } = await connected;
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBeFalsy();
    expect(requests.map((r) => `${r.method} ${r.headers.Authorization ?? ""}`)).toEqual([
      "GET Bearer stale",
      "GET Bearer stale",
      "POST ",
      "GET Bearer fresh",
    ]);
    expect(sleeps).toEqual([1000]);
  });

  it("a 401 followed by a 429 on the retried request still retries (401, 429, success)", async () => {
    const { sleeps, connected } = setup(
      (req, n) => {
        if (isToken(req)) return tokenResponse();
        if (req.headers.Authorization === "Bearer stale") return new Response("expired", { status: 401 });
        return n === 3 ? limited({ "retry-after": "3" }) : new Response('{"ok":1}');
      },
      { configDir: seedStale() },
    );
    const { client, requests } = await connected;
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBeFalsy();
    expect(requests.filter(isToken)).toHaveLength(1);
    expect(requests.map((r) => r.headers.Authorization ?? "token")).toEqual([
      "Bearer stale",
      "token",
      "Bearer fresh",
      "Bearer fresh",
    ]);
    expect(sleeps).toEqual([3000]);
  });

  it("bounds total rate-limit retries per call across a refresh", async () => {
    const { sleeps, connected } = setup(
      (req, n) => {
        if (isToken(req)) return tokenResponse();
        return n <= 2 ? limited() : req.headers.Authorization === "Bearer stale" ? new Response("x", { status: 401 }) : limited();
      },
      { configDir: seedStale() },
    );
    const { client, requests } = await connected;
    const res = await client.callTool(RECEIPTS);
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Etsy API 429");
    expect(requests.filter(isToken)).toHaveLength(1);
    expect(sleeps).toHaveLength(3);
    expect(requests).toHaveLength(6);
  });
});
