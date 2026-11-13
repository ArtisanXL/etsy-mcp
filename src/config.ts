export interface Config {
  apiKey: string;
  sharedSecret: string;
  accessToken?: string;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const apiKey = env.ETSY_API_KEY;
  const sharedSecret = env.ETSY_SHARED_SECRET;
  if (!apiKey) throw new Error("ETSY_API_KEY environment variable is required");
  if (!sharedSecret) throw new Error("ETSY_SHARED_SECRET environment variable is required");
  return { apiKey, sharedSecret, accessToken: env.ETSY_ACCESS_TOKEN || undefined };
}
