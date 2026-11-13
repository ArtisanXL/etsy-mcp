import type {
  OperationDescriptor,
  ParamDescriptor,
  ParamLocation,
  PropertyDescriptor,
  Toolset,
  ValueSchema,
} from "./operation.js";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export const TAG_TOOLSETS: Record<string, Toolset> = {
  ShopListing: "listings",
  "ShopListing File": "listings",
  "ShopListing Image": "listings",
  "ShopListing Inventory": "listings",
  "ShopListing Personalization": "listings",
  "ShopListing Product": "listings",
  "ShopListing Translation": "listings",
  "ShopListing VariationImage": "listings",
  "ShopListing Video": "listings",
  Shop: "shop",
  "Shop Section": "shop",
  "Shop Return Policy": "shop",
  "Shop ProductionPartner": "shop",
  "Shop Economic Operators": "shop",
  "Shop ShippingProfile": "shipping",
  "Shop ProcessingProfiles": "shipping",
  "Shop HolidayPreferences": "shipping",
  "Shop Receipt": "orders",
  "Shop Receipt Transactions": "orders",
  Payment: "orders",
  "Ledger Entry": "orders",
  Review: "reviews",
  BuyerTaxonomy: "taxonomy",
  SellerTaxonomy: "taxonomy",
  User: "users",
  UserAddress: "users",
  Other: "other",
};

/** Non-GET Operations that change nothing on Etsy, so they stay available in Read-only Mode. */
export const READ_ONLY_OVERRIDES: ReadonlySet<string> = new Set(["tokenScopes"]);

const BODY_LOCATIONS: Record<string, ParamLocation> = {
  "application/x-www-form-urlencoded": "body-form",
  "application/json": "body-json",
  "multipart/form-data": "body-multipart",
};

function toToolset(tags: unknown, label: string): Toolset {
  const list: string[] = Array.isArray(tags) ? tags : [];
  if (list.length === 0) throw new Error(`Operation has no tag, cannot assign a Toolset: ${label}`);
  const toolsets = new Set<Toolset>();
  for (const tag of list) {
    const toolset = Object.hasOwn(TAG_TOOLSETS, tag) ? TAG_TOOLSETS[tag] : undefined;
    if (!toolset) throw new Error(`Unmapped tag "${tag}" (${label}): add it to TAG_TOOLSETS in src/generator.ts`);
    toolsets.add(toolset);
  }
  if (toolsets.size > 1) {
    throw new Error(`Tags [${list.join(", ")}] map to multiple Toolsets (${label}); an Operation needs exactly one`);
  }
  return [...toolsets][0];
}

export function toToolName(operationId: string): string {
  return operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function generateOperations(spec: any): OperationDescriptor[] {
  const out: OperationDescriptor[] = [];
  const seen = new Map<string, string>();
  for (const [path, item] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const label = `${method.toUpperCase()} ${path}`;
      if (!op.operationId) throw new Error(`Missing operationId: ${label}`);
      const toolName = toToolName(op.operationId);
      const prior = seen.get(toolName);
      if (prior) throw new Error(`Duplicate Tool name "${toolName}": ${prior} and ${label}`);
      seen.set(toolName, label);
      out.push({
        toolName,
        operationId: op.operationId,
        description: op.description ?? "",
        method: method.toUpperCase() as OperationDescriptor["method"],
        path,
        scopes: [...new Set<string>((op.security ?? []).flatMap((s: any) => s.oauth2 ?? []))],
        oauth2: (op.security ?? []).some((s: any) => Object.hasOwn(s, "oauth2")),
        write: method !== "get" && !READ_ONLY_OVERRIDES.has(op.operationId),
        toolset: toToolset(op.tags, label),
        params: toParams(spec, op, label),
      });
    }
  }
  return out.sort((a, b) => (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0));
}

function deref(spec: any, node: any): any {
  const seen = new Set<string>();
  while (node && typeof node.$ref === "string") {
    const ref: string = node.$ref;
    if (!ref.startsWith("#/")) throw new Error(`Unsupported non-local $ref: ${ref}`);
    if (seen.has(ref)) throw new Error(`Circular $ref: ${ref}`);
    seen.add(ref);
    node = ref
      .slice(2)
      .split("/")
      .reduce((acc: any, key) => acc?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
    if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  }
  return node;
}

function toValueSchema(spec: any, raw: any): ValueSchema {
  const s = deref(spec, raw) ?? {};
  const out: ValueSchema = { type: s.type };
  if (s.nullable === true) out.nullable = true;
  if (typeof s.minimum === "number") out.minimum = s.minimum;
  if (typeof s.maximum === "number") out.maximum = s.maximum;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (s.type === "array" && s.items) out.items = toValueSchema(spec, s.items);
  if (s.type === "object" && s.properties) out.properties = toProperties(spec, s);
  return out;
}

function toProperty(spec: any, name: string, raw: any, requiredByParent: boolean, description?: string): PropertyDescriptor {
  const schema = deref(spec, raw) ?? {};
  const { type, ...rest } = toValueSchema(spec, schema);
  const text = description ?? schema.description;
  return {
    name,
    required: requiredByParent && schema.nullable !== true,
    type,
    ...(text ? { description: text } : {}),
    ...rest,
  };
}

function toProperties(spec: any, objectSchema: any): PropertyDescriptor[] {
  const required: string[] = Array.isArray(objectSchema.required) ? objectSchema.required : [];
  return Object.entries<any>(objectSchema.properties).map(([name, schema]) =>
    toProperty(spec, name, schema, required.includes(name)),
  );
}

function toParams(spec: any, op: any, label: string): ParamDescriptor[] {
  const params: ParamDescriptor[] = (op.parameters ?? []).map((raw: any) => {
    const p = deref(spec, raw);
    const { name, ...rest } = toProperty(spec, p.name, p.schema, p.required === true, p.description);
    return { name, in: p.in, ...rest };
  });
  const body = deref(spec, op.requestBody);
  if (!body) return params;
  const entries = Object.entries<any>(body.content ?? {});
  if (entries.length !== 1) throw new Error(`Request body must have exactly one content type (${label})`);
  const [contentType, media] = entries[0];
  const base = BODY_LOCATIONS[contentType];
  if (!base) throw new Error(`Unsupported request body content type "${contentType}" (${label})`);
  const schema = deref(spec, media.schema) ?? {};
  if (schema.type !== "object") throw new Error(`Request body schema must be an object (${label})`);
  const taken = new Set(params.map((p) => p.name));
  for (const prop of toProperties(spec, schema)) {
    if (taken.has(prop.name)) throw new Error(`Body field "${prop.name}" collides with a path/query parameter (${label})`);
    const flat = base === "body-form" && (prop.type === "object" || prop.items?.type === "object" || prop.items?.type === "array");
    if (flat) throw new Error(`Form-encoded body field "${prop.name}" must be a scalar or array of scalars (${label})`);
    const binary = base === "body-multipart" && deref(spec, schema.properties[prop.name]).format === "binary";
    const { name, ...rest } = prop;
    params.push({ name, in: binary ? "body-multipart-file" : base, ...rest });
  }
  return params;
}
