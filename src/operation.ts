export const TOOLSETS = ["listings", "shop", "shipping", "orders", "reviews", "taxonomy", "users", "other"] as const;
export type Toolset = (typeof TOOLSETS)[number];

export type ParamLocation = "path" | "query" | "body-form" | "body-json" | "body-multipart" | "body-multipart-file";
export type ParamType = "integer" | "number" | "string" | "boolean" | "array" | "object";

export interface ValueSchema {
  type: ParamType;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  items?: ValueSchema;
  /** The spec allows an explicit null; null is sent in JSON bodies and omitted from query/form. */
  nullable?: true;
  /** Fields of a nested JSON object. */
  properties?: PropertyDescriptor[];
}

export interface PropertyDescriptor extends ValueSchema {
  name: string;
  required: boolean;
  description?: string;
}

export interface ParamDescriptor extends PropertyDescriptor {
  in: ParamLocation;
}

export interface OperationDescriptor {
  toolName: string;
  operationId: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  scopes: string[];
  /** True when the Operation's security includes oauth2, i.e. it needs a Bearer token. */
  oauth2: boolean;
  /** True when the Operation changes Etsy state; false for GETs and read-only overrides such as tokenScopes. */
  write: boolean;
  toolset: Toolset;
  params: ParamDescriptor[];
}
