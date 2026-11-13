import type { OperationDescriptor, ParamDescriptor, Toolset, ValueSchema } from "./operation.js";

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
        write: method !== "get",
        toolset: toToolset(op.tags, label),
        params: (op.parameters ?? []).map((p: any) => toParam(spec, p)),
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
  if (typeof s.minimum === "number") out.minimum = s.minimum;
  if (typeof s.maximum === "number") out.maximum = s.maximum;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (s.type === "array" && s.items) out.items = toValueSchema(spec, s.items);
  return out;
}

function toParam(spec: any, raw: any): ParamDescriptor {
  const p = deref(spec, raw);
  const schema = deref(spec, p.schema) ?? {};
  const { type, ...rest } = toValueSchema(spec, schema);
  return {
    name: p.name,
    in: p.in,
    required: p.required === true && schema.nullable !== true,
    type,
    ...(p.description ? { description: p.description } : {}),
    ...rest,
  };
}
