# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Tools are now generated from a committed Etsy Spec Snapshot: 64 read Tools named by snake_case `operationId`. **Breaking:** the old hand-written names `find_shops`, `search_listings` and `get_shop_listings` are gone (use `get_listing`-style generated names). Non-2xx responses now return a Tool error (`isError`) with status and body. Input schemas carry enums, bounds, required/optional and array types from the spec; array query params are sent comma-joined.
- Requests now send `x-api-key` as `keystring:shared_secret`; the new `ETSY_SHARED_SECRET` env var is required alongside `ETSY_API_KEY`, and the server fails at startup if either is missing.
- Server is built by a testable `createServer` factory; added Vitest tests.

## [0.1.1] - 2026-11-13

### Changed

- First public npm release (0.1.0 was never published to npm).

## [0.1.0] - 2026-11-13

### Added

- Initial MCP server with `get_shop`, `find_shops`, `get_listing`, `search_listings`, `get_shop_listings` tools.
