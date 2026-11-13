# Generate Tools from a committed Spec Snapshot

We expose every Etsy Open API v3 Operation as its own Tool, generated at build time from a Spec Snapshot committed to the repo; the generated TypeScript is committed too. Hand-writing ~107 Tools doesn't scale or track Etsy's changes; loading the spec at runtime removes type safety and adds a network dependency at startup; a single generic `call_endpoint` Tool gives agents no per-Operation schema to reason with. Committing both snapshot and output makes every upstream API change a reviewable diff (refreshed by a weekly PR job, with CI verifying the output is in sync).

## Consequences

- Tool names follow `operationId` (snake_case), which broke the five hand-written 0.1.x tool names (released as 0.2.0).
- Tool count is managed with Toolsets and Read-only Mode rather than by merging Operations into fewer Tools.
