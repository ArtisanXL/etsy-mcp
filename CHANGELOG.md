# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-13

Every Etsy Open API v3 Operation is now a Tool (107, up from 5), with Toolsets, Read-only Mode, automatic OAuth token refresh, a `login` command, file uploads and rate-limit handling. This release has breaking changes; see "Migrating from 0.1.x" below.

### Migrating from 0.1.x

Tools are now named after Etsy's `operationId` in snake_case, so two of the five 0.1.x Tools were renamed (the other three keep their names and gain the full spec input schema):

| 0.1.x Tool | 0.2.0 Tool |
| --- | --- |
| `get_shop` | `get_shop` (unchanged) |
| `find_shops` | `find_shops` (unchanged) |
| `get_listing` | `get_listing` (unchanged) |
| `search_listings` | `find_all_listings_active` |
| `get_shop_listings` | `find_all_active_listings_by_shop` |

Other things to change:

- `ETSY_SHARED_SECRET` is now required alongside `ETSY_API_KEY`; the server exits at startup if either is missing.
- `ETSY_ACCESS_TOKEN` is removed. If it is still set, a deprecation warning is printed to stderr and the value is ignored. Run `npx @artisanxl/etsy-mcp login` instead (or set `ETSY_REFRESH_TOKEN` for headless use). Access tokens now refresh automatically.
- Register `http://localhost:3003/callback` as a redirect URI in your Etsy app before running `login` (or the matching port if you set `ETSY_REDIRECT_PORT`).
- The server starts in Read-only Mode. Set `ETSY_ALLOW_WRITES=true` to offer Write Tools.
- Non-2xx responses are now Tool errors (`isError: true`) with the HTTP status and body.

### Added

- 107 Tools generated from a committed Etsy Spec Snapshot, named by snake_case `operationId`. Input schemas carry enums, bounds, required/optional and array types from the spec; path, query and body fields form one flat input set. Array query and form-urlencoded values are sent comma-joined, JSON bodies as real JSON (nested objects and arrays supported).
- Toolsets: every Tool belongs to one of 8 Toolsets (`listings`, `shop`, `shipping`, `orders`, `reviews`, `taxonomy`, `users`, `other`), assigned from the Etsy tag. New `ETSY_TOOLSETS` env var (comma-separated) narrows the offered Tools; unset means all, and an unknown or empty value fails at startup listing the valid names.
- Read-only Mode and Write Tools: by default only the 64 GET Tools plus `token_scopes` (a POST that changes nothing) are offered. New `ETSY_ALLOW_WRITES=true` also offers the 42 Write Tools (other POST/PUT/PATCH/DELETE Operations). Every Tool carries `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` annotations.
- `npx @artisanxl/etsy-mcp login [--scopes a,b]`: OAuth 2.0 PKCE (S256) with `state` verification and a one-shot callback on `localhost:3003` (`ETSY_REDIRECT_PORT` to change). Requests every Operation scope unless narrowed, and saves tokens (0600) to `~/.config/etsy-mcp/tokens.json`.
- OAuth Operations send a Bearer access token; public Operations never load or refresh a token. Access tokens are refreshed shortly before expiry and once on a 401 (concurrent calls share one refresh), and the refreshed pair is persisted. New `ETSY_REFRESH_TOKEN` env var seeds the token file for headless use; a token file without `seed_sha256` (such as a `login` result) wins over it and is then marked as seeded, so a stale env value never overwrites it. A missing token, or a 403, returns an error pointing at `login`.
- File uploads: `upload_listing_image`, `upload_listing_file` and `upload_listing_video` (Write Tools) take an absolute local file path in their `image` / `file` / `video` field, read it and send multipart with the original filename. The field stays optional where the spec says so; a missing or unreadable path returns a Tool error without any HTTP call.
- Rate limits: a 429 is retried up to 3 times per Tool call, waiting `Retry-After` (seconds or HTTP date; 1s if absent, capped at 60s). A 429 with `x-remaining-today: 0` or a `Retry-After` longer than 60s (daily quota exhausted) is returned immediately with a hint that retrying will not help; exhausted retries also add a hint. Cancelling the MCP request aborts the wait.
- `npm run gen` downloads the latest Etsy spec into the Spec Snapshot and then runs `gen:local` (offline). A weekly (and manually dispatchable) `spec-refresh` workflow runs it on the upstream repo only and opens a PR when the snapshot or generated output changed; generation fails on an unmapped tag, a missing `operationId` or a duplicate Tool name. CI runs `gen:local` and fails on any diff.
- Vitest test suite exercising the server through an in-memory MCP client with a fake HTTP layer.

### Changed

- Requests now send `x-api-key` as `keystring:shared_secret`, as the current Etsy API requires.
- The server is built by a testable `createServer` factory, and the reported server version is 0.2.0.

### Removed

- `ETSY_ACCESS_TOKEN` (see migration notes above).

## [0.1.1] - 2026-11-13

### Changed

- First public npm release (0.1.0 was never published to npm).

## [0.1.0] - 2026-11-13

### Added

- Initial MCP server with `get_shop`, `find_shops`, `get_listing`, `search_listings`, `get_shop_listings` tools.
