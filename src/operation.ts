export type ParamLocation = "path" | "query";
export type ParamType = "integer" | "number" | "string" | "boolean" | "array";

export interface ParamDescriptor {
  name: string;
  in: ParamLocation;
  required: boolean;
  type: ParamType;
  description?: string;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
}

export interface OperationDescriptor {
  toolName: string;
  operationId: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  scopes: string[];
  write: boolean;
  toolset: string;
  params: ParamDescriptor[];
}
