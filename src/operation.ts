export const TOOLSETS = ["listings", "shop", "shipping", "orders", "reviews", "taxonomy", "users", "other"] as const;
export type Toolset = (typeof TOOLSETS)[number];

export type ParamLocation = "path" | "query";
export type ParamType = "integer" | "number" | "string" | "boolean" | "array";

export interface ValueSchema {
  type: ParamType;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  items?: ValueSchema;
}

export interface ParamDescriptor extends ValueSchema {
  name: string;
  in: ParamLocation;
  required: boolean;
  description?: string;
}

export interface OperationDescriptor {
  toolName: string;
  operationId: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  scopes: string[];
  write: boolean;
  toolset: Toolset;
  params: ParamDescriptor[];
}
