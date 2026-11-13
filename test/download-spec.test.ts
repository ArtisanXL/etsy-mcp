import { describe, expect, it } from "vitest";
import { downloadSpec } from "../scripts/download-spec.js";

const respond = (body: string, status = 200): typeof fetch => (async () => new Response(body, { status })) as typeof fetch;
const valid = JSON.stringify({ openapi: "3.0.2", paths: { "/v3/application/x": {} } });

describe("downloadSpec", () => {
  it("returns the body verbatim with a trailing newline", async () => {
    const body = '{"openapi": "3.0.2", "paths": {"/a": {"get": {"tags": ["A", "B"]}}}}';
    expect(await downloadSpec(respond(body))).toBe(`${body}\n`);
    expect(await downloadSpec(respond(`${body}\n`))).toBe(`${body}\n`);
  });

  it("requests the given URL", async () => {
    let requested = "";
    const fake = (async (url: string) => {
      requested = url;
      return new Response(valid);
    }) as unknown as typeof fetch;
    await downloadSpec(fake, "https://example.test/spec.json");
    expect(requested).toBe("https://example.test/spec.json");
  });

  it.each([
    ["an HTTP error", respond("nope", 503), /HTTP 503/],
    ["non-JSON", respond("<html>maintenance</html>"), /not valid JSON/],
    ["JSON that is not OpenAPI 3", respond('{"swagger":"2.0","paths":{"/a":{}}}'), /not an OpenAPI 3 document/],
    ["null", respond("null"), /not an OpenAPI 3 document/],
    ["a spec without paths", respond('{"openapi":"3.0.2","paths":{}}'), /no paths/],
  ])("rejects %s", async (_label, fake, message) => {
    await expect(downloadSpec(fake)).rejects.toThrow(message);
  });
});
