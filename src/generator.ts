import type { OperationDescriptor, ParamDescriptor, ValueSchema } from "./operation.js";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export const PLACEHOLDER_TOOLSET = "all";

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
        toolset: PLACEHOLDER_TOOLSET,
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
