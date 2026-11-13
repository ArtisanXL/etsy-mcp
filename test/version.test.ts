import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connect } from "./harness.js";

describe("version", () => {
  it("reports the package version as the server version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: "etsy-mcp", version: pkg.version });
    expect(pkg.version).toBe("0.2.0");
  });
});
