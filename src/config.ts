import { defaultConfigDir } from "./token-store.js";
import { TOOLSETS, type Toolset } from "./operation.js";

export interface Config {
  apiKey: string;
  sharedSecret: string;
  /** Seeds the token store (ETSY_REFRESH_TOKEN). */
  refreshToken?: string;
  /** Directory holding tokens.json. */
  configDir: string;
  /** Enabled Toolsets; undefined means all. */
  toolsets?: Toolset[];
  /** Offer Write Tools (ETSY_ALLOW_WRITES=true); false is Read-only Mode. */
  allowWrites: boolean;
}

export function loadConfig(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = (m) => console.error(`etsy-mcp: ${m}`),
): Config {
  const apiKey = env.ETSY_API_KEY;
  const sharedSecret = env.ETSY_SHARED_SECRET;
  if (!apiKey) throw new Error("ETSY_API_KEY environment variable is required");
  if (!sharedSecret) throw new Error("ETSY_SHARED_SECRET environment variable is required");
  if (env.ETSY_ACCESS_TOKEN) {
    warn(
      "ETSY_ACCESS_TOKEN is no longer used and is ignored. Run `npx @artisanxl/etsy-mcp login`, or set ETSY_REFRESH_TOKEN.",
    );
  }
  return {
    apiKey,
    sharedSecret,
    refreshToken: env.ETSY_REFRESH_TOKEN || undefined,
    configDir: defaultConfigDir(),
    toolsets: parseToolsets(env.ETSY_TOOLSETS),
    allowWrites: parseAllowWrites(env.ETSY_ALLOW_WRITES),
  };
}

function parseAllowWrites(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error(`ETSY_ALLOW_WRITES must be "true" or "false", got "${raw}". Unset it for Read-only Mode.`);
}

function parseToolsets(raw: string | undefined): Toolset[] | undefined {
  if (raw === undefined) return undefined;
  const valid = `Valid Toolsets: ${TOOLSETS.join(", ")}`;
  const names = raw.split(",").map((n) => n.trim());
  if (names.every((n) => n === "")) {
    throw new Error(`ETSY_TOOLSETS is set but empty. ${valid}. Unset it to enable all Toolsets.`);
  }
  const unknown = names.filter((n) => !(TOOLSETS as readonly string[]).includes(n));
  if (unknown.length > 0) {
    const shown = unknown.map((n) => (n === "" ? "(empty entry)" : `"${n}"`)).join(", ");
    throw new Error(`Unknown Toolset in ETSY_TOOLSETS: ${shown}. ${valid}`);
  }
  return [...new Set(names as Toolset[])];
}
