# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Tools are now generated from a committed Etsy Spec Snapshot: 64 read Tools named by snake_case `operationId`. **Breaking:** the old hand-written names `find_shops`, `search_listings` and `get_shop_listings` are gone (use `get_listing`-style generated names). Non-2xx responses now return a Tool error (`isError`) with status and body. Input schemas carry enums, bounds, required/optional and array types from the spec; array query params are sent comma-joined.
- Requests now send `x-api-key` as `keystring:shared_secret`; the new `ETSY_SHARED_SECRET` env var is required alongside `ETSY_API_KEY`, and the server fails at startup if either is missing.
- Every Tool belongs to one of 8 Toolsets (`listings`, `shop`, `shipping`, `orders`, `reviews`, `taxonomy`, `users`, `other`), assigned from the Etsy tag; generation fails on an unmapped tag. New `ETSY_TOOLSETS` env var (comma-separated) narrows the offered Tools; unset means all, and an unknown or empty value fails at startup listing the valid names.
- OAuth: Tools whose Operation requires `oauth2` send a Bearer access token read from `~/.config/etsy-mcp/tokens.json` (0600); public Operations never load or refresh a token. Access tokens are refreshed shortly before expiry and once on a 401 (concurrent calls share one refresh) and the refreshed pair is persisted. New `ETSY_REFRESH_TOKEN` env var seeds the token file for headless use. A missing token or a 403 returns an error pointing at `login`. **Breaking:** `ETSY_ACCESS_TOKEN` is removed; setting it logs a deprecation warning to stderr.
- New `npx @artisanxl/etsy-mcp login [--scopes a,b]` command: OAuth 2.0 PKCE (S256) with `state` verification, one-shot callback on `localhost:3003` (`ETSY_REDIRECT_PORT` to change), requests every Operation scope unless narrowed, and saves tokens (0600) to the token file. A token file without `seed_sha256` (such as a login result) wins over `ETSY_REFRESH_TOKEN` and is then marked as seeded, so a stale env value never overwrites it.
- Write Tools: POST/PUT/PATCH/DELETE Operations are offered only when `ETSY_ALLOW_WRITES=true`; the default is Read-only Mode, which still offers `token_scopes` (a POST that changes nothing). Body fields join path/query parameters in one flat input set and are sent form-urlencoded (arrays comma-joined) or as JSON (nested objects, real arrays) per the Operation. Every Tool now carries `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` annotations.
- File uploads: `upload_listing_image`, `upload_listing_file` and `upload_listing_video` (Write Tools) take an absolute local file path in their `image` / `file` / `video` field, read it and send multipart with the original filename. The field stays optional where the spec says so (e.g. `listing_image_id` instead of `image` reads no file); a missing or unreadable path returns a Tool error without any HTTP call.
- Rate limits: a 429 is retried up to 3 times per Tool call, waiting `Retry-After` (seconds or HTTP date; 1s if absent, capped at 60s). A 429 with `x-remaining-today: 0` or a `Retry-After` longer than 60s (daily quota exhausted) is returned immediately as an error with a hint that retrying will not help; exhausted retries also add a hint. Cancelling the MCP request aborts the wait and stops retrying. Rate-limit retries share one budget per call and do not consume the single 401 refresh.
- Server is built by a testable `createServer` factory; added Vitest tests.

## [0.1.1] - 2026-11-13

### Changed

- First public npm release (0.1.0 was never published to npm).

## [0.1.0] - 2026-11-13

### Added

- Initial MCP server with `get_shop`, `find_shops`, `get_listing`, `search_listings`, `get_shop_listings` tools.
