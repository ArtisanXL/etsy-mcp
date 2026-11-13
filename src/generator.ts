import type { OperationDescriptor, ParamDescriptor } from "./operation.js";

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
        params: (op.parameters ?? []).map(toParam),
      });
    }
  }
  return out.sort((a, b) => (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0));
}

function toParam(p: any): ParamDescriptor {
  const s = p.schema ?? {};
  const d: ParamDescriptor = {
    name: p.name,
    in: p.in,
    required: p.required === true,
    type: s.type,
  };
  if (p.description) d.description = p.description;
  if (typeof s.minimum === "number") d.minimum = s.minimum;
  if (typeof s.maximum === "number") d.maximum = s.maximum;
  if (Array.isArray(s.enum)) d.enum = s.enum;
  return d;
}
