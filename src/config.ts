import { TOOLSETS, type Toolset } from "./operation.js";

export interface Config {
  apiKey: string;
  sharedSecret: string;
  accessToken?: string;
  /** Enabled Toolsets; undefined means all. */
  toolsets?: Toolset[];
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const apiKey = env.ETSY_API_KEY;
  const sharedSecret = env.ETSY_SHARED_SECRET;
  if (!apiKey) throw new Error("ETSY_API_KEY environment variable is required");
  if (!sharedSecret) throw new Error("ETSY_SHARED_SECRET environment variable is required");
  return {
    apiKey,
    sharedSecret,
    accessToken: env.ETSY_ACCESS_TOKEN || undefined,
    toolsets: parseToolsets(env.ETSY_TOOLSETS),
  };
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
