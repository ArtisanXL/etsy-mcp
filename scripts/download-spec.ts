export const SPEC_URL = "https://www.etsy.com/openapi/generated/oas/3.0.0.json";

export async function downloadSpec(fetchFn: typeof fetch, url: string = SPEC_URL): Promise<string> {
  const res = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Spec download failed: HTTP ${res.status} from ${url}`);
  const text = await res.text();

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error(`Spec download failed: response from ${url} is not valid JSON`);
  }
  const { openapi, paths } = (doc ?? {}) as { openapi?: unknown; paths?: unknown };
  if (typeof openapi !== "string" || !openapi.startsWith("3.")) {
    throw new Error(`Spec download failed: response from ${url} is not an OpenAPI 3 document`);
  }
  if (typeof paths !== "object" || paths === null || Object.keys(paths).length === 0) {
    throw new Error(`Spec download failed: OpenAPI document from ${url} has no paths`);
  }
  return text.endsWith("\n") ? text : `${text}\n`;
}
