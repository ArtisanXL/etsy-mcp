import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connect, tempConfigDir } from "./harness.js";

const NOW = 1_700_000_000_000;
const now = () => NOW;

function authedConfigDir() {
  const dir = tempConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "tokens.json"),
    JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: NOW + 3_600_000 }),
  );
  return dir;
}

const writing = (readFile?: (p: string) => Promise<Uint8Array>) =>
  connect({ allowWrites: true, configDir: authedConfigDir() }, undefined, { now, readFile });

const tempFile = (name: string, bytes: Uint8Array | string) => {
  const dir = mkdtempSync(join(tmpdir(), "etsy-mcp-upload-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

const bytesOf = async (f: FormDataEntryValue) => new Uint8Array(await (f as File).arrayBuffer());

describe("file uploads from local paths", () => {
  it("upload_listing_image sends multipart with file bytes, filename and other fields", async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10]);
    const path = tempFile("mug photo.jpg", data);
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "upload_listing_image",
      arguments: { shop_id: 9, listing_id: 5, image: path, rank: 2, overwrite: true, alt_text: "A mug" },
    });
    expect(res.isError).toBeFalsy();
    const [req] = requests;
    expect(req.method).toBe("POST");
    expect(req.url.href).toBe("https://openapi.etsy.com/v3/application/shops/9/listings/5/images");
    expect(req.headers["Content-Type"]).toBeUndefined();
    expect(req.headers.Authorization).toBe("Bearer a");
    expect(req.headers["x-api-key"]).toBe("key:secret");
    const file = req.form!.get("image") as File;
    expect(file.name).toBe("mug photo.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(await bytesOf(file)).toEqual(data);
    expect(req.form!.get("rank")).toBe("2");
    expect(req.form!.get("overwrite")).toBe("true");
    expect(req.form!.get("alt_text")).toBe("A mug");
    expect(req.form!.has("shop_id")).toBe(false);
  });

  it("upload_listing_file sends the file with its original filename", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const path = tempFile("pattern.pdf", data);
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "upload_listing_file",
      arguments: { shop_id: 1, listing_id: 2, file: path, name: "pattern.pdf", rank: 1 },
    });
    expect(res.isError).toBeFalsy();
    const [req] = requests;
    expect(req.url.pathname).toBe("/v3/application/shops/1/listings/2/files");
    const file = req.form!.get("file") as File;
    expect(file.name).toBe("pattern.pdf");
    expect(await bytesOf(file)).toEqual(data);
    expect(req.form!.get("name")).toBe("pattern.pdf");
  });

  it("upload_listing_video sends the file with its original filename", async () => {
    const data = new Uint8Array([9, 8, 7]);
    const path = tempFile("demo.mp4", data);
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "upload_listing_video",
      arguments: { shop_id: 1, listing_id: 2, video: path, name: "demo.mp4" },
    });
    expect(res.isError).toBeFalsy();
    const [req] = requests;
    expect(req.url.pathname).toBe("/v3/application/shops/1/listings/2/videos");
    const file = req.form!.get("video") as File;
    expect(file.name).toBe("demo.mp4");
    expect(file.type).toBe("video/mp4");
    expect(await bytesOf(file)).toEqual(data);
  });

  it("reads files through the injected file reader", async () => {
    const read: string[] = [];
    const { client, requests } = await writing(async (p) => {
      read.push(p);
      return new Uint8Array([5]);
    });
    await client.callTool({
      name: "upload_listing_image",
      arguments: { shop_id: 1, listing_id: 2, image: "/virtual/dir/pic.png" },
    });
    expect(read).toEqual(["/virtual/dir/pic.png"]);
    expect((requests[0].form!.get("image") as File).name).toBe("pic.png");
  });

  it("upload_listing_image with listing_image_id and no image reads no file", async () => {
    const read: string[] = [];
    const { client, requests } = await writing(async (p) => {
      read.push(p);
      return new Uint8Array();
    });
    const res = await client.callTool({
      name: "upload_listing_image",
      arguments: { shop_id: 1, listing_id: 2, listing_image_id: 77 },
    });
    expect(res.isError).toBeFalsy();
    expect(read).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].form!.get("listing_image_id")).toBe("77");
    expect(requests[0].form!.has("image")).toBe(false);
  });

  it("omits an explicit null file and reads nothing", async () => {
    const read: string[] = [];
    const { client, requests } = await writing(async (p) => {
      read.push(p);
      return new Uint8Array();
    });
    await client.callTool({
      name: "upload_listing_image",
      arguments: { shop_id: 1, listing_id: 2, listing_image_id: 3, image: null },
    });
    expect(read).toEqual([]);
    expect(requests[0].form!.has("image")).toBe(false);
  });

  it("a missing path returns a clear Tool error and makes no HTTP call", async () => {
    const { client, requests } = await writing();
    const missing = join(tmpdir(), "etsy-mcp-does-not-exist", "nope.jpg");
    const res = await client.callTool({
      name: "upload_listing_image",
      arguments: { shop_id: 1, listing_id: 2, image: missing },
    });
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("Cannot read file");
    expect(text).toContain("image");
    expect(text).toContain("nope.jpg");
    expect(text).toContain("ENOENT");
    expect(requests).toHaveLength(0);
  });

  it("an unreadable path (a directory) returns a Tool error and makes no HTTP call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "etsy-mcp-upload-"));
    const { client, requests } = await writing();
    const res = await client.callTool({
      name: "upload_listing_video",
      arguments: { shop_id: 1, listing_id: 2, video: dir },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Cannot read file");
    expect(requests).toHaveLength(0);
  });

  it.each(["relative/pic.jpg", "pic.jpg", "./pic.jpg", "~/pic.jpg"])(
    "rejects the non-absolute path %s with a clear error and no HTTP call",
    async (image) => {
      const read: string[] = [];
      const { client, requests } = await writing(async (p) => {
        read.push(p);
        return new Uint8Array();
      });
      const res = await client.callTool({
        name: "upload_listing_image",
        arguments: { shop_id: 1, listing_id: 2, image },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/absolute local path/);
      expect(read).toEqual([]);
      expect(requests).toHaveLength(0);
    },
  );

  it("describes the file field as an absolute local path", async () => {
    const { client } = await writing();
    const tool = (await client.listTools()).tools.find((t) => t.name === "upload_listing_image")!;
    const props = tool.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.image.description).toMatch(/absolute local path/i);
    expect(tool.inputSchema.required).not.toContain("image");
  });

  it("is still gated by Read-only Mode", async () => {
    const { client, requests } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("upload_listing_image");
    const res = await client.callTool({ name: "upload_listing_image", arguments: { shop_id: 1, listing_id: 2 } });
    expect(res.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it("re-sends the same multipart body after a 401 refresh", async () => {
    let calls = 0;
    const dir = authedConfigDir();
    const { client, requests } = await connect(
      { allowWrites: true, configDir: dir },
      async (req) => {
        if (req.form) await new Response(req.form).arrayBuffer();
        if (req.url.pathname.endsWith("/token")) {
          return new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }));
        }
        return ++calls === 1 ? new Response("expired", { status: 401 }) : new Response('{"ok":true}');
      },
      { now },
    );
    const path = tempFile("a.png", new Uint8Array([1, 2]));
    const res = await client.callTool({
      name: "upload_listing_image",
      arguments: { shop_id: 1, listing_id: 2, image: path },
    });
    expect(res.isError).toBeFalsy();
    const uploads = requests.filter((r) => r.url.pathname.endsWith("/images"));
    expect(uploads).toHaveLength(2);
    expect(await bytesOf(uploads[1].form!.get("image")!)).toEqual(new Uint8Array([1, 2]));
    expect(uploads[1].headers.Authorization).toBe("Bearer new");
  });
});
