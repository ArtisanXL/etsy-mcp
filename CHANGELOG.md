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
- New `npx @artisanxl/etsy-mcp login [--scopes a,b]` command: OAuth 2.0 PKCE (S256) with `state` verification, one-shot callback on `localhost:3003` (`ETSY_REDIRECT_PORT` to change), requests every Operation scope unless narrowed, and saves tokens (0600) to the token file. A login records `ETSY_REFRESH_TOKEN` (if set) as already seeded so it is not overwritten on the next start.
- Server is built by a testable `createServer` factory; added Vitest tests.

## [0.1.1] - 2026-11-13

### Changed

- First public npm release (0.1.0 was never published to npm).

## [0.1.0] - 2026-11-13

### Added

- Initial MCP server with `get_shop`, `find_shops`, `get_listing`, `search_listings`, `get_shop_listings` tools.
