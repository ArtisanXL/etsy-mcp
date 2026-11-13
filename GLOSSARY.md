# Etsy MCP

An MCP server that exposes the Etsy Open API v3 to AI agents as callable tools.

## Language

**Operation**:
A single Etsy Open API v3 endpoint + HTTP method, identified by its `operationId` in the Etsy spec.
_Avoid_: Endpoint, route, API call

**Tool**:
The MCP-facing exposure of exactly one Operation, named as the snake_case form of its `operationId`.
_Avoid_: Command, action, function

**Toolset**:
A named group of Tools that a user can enable or disable as a unit.
_Avoid_: Category, module, tag

**Spec Snapshot**:
The copy of Etsy's OpenAPI document kept in this repo, from which all Tools are derived.
_Avoid_: Schema, swagger

**Write Tool**:
A Tool whose Operation changes Etsy state (create, update or delete).
_Avoid_: Mutation, unsafe tool

**Read-only Mode**:
The default server mode, in which no Write Tools are offered.
_Avoid_: Safe mode, dry run
