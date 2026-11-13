# @artisanxl/etsy-mcp

[![npm](https://img.shields.io/npm/v/@artisanxl/etsy-mcp)](https://www.npmjs.com/package/@artisanxl/etsy-mcp)
[![CI](https://github.com/ArtisanXL/etsy-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ArtisanXL/etsy-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MCP server for the [Etsy Open API v3](https://developers.etsy.com/documentation/).

## Usage

```json
{
  "mcpServers": {
    "etsy": {
      "command": "npx",
      "args": ["-y", "@artisanxl/etsy-mcp"],
      "env": {
        "ETSY_API_KEY": "your-keystring",
        "ETSY_SHARED_SECRET": "your-shared-secret"
      }
    }
  }
}
```

Claude Code:

```sh
claude mcp add etsy -e ETSY_API_KEY=your-keystring -e ETSY_SHARED_SECRET=your-shared-secret -- npx -y @artisanxl/etsy-mcp
```

## Tools

One Tool per Etsy Open API v3 Operation (107), named as the snake_case `operationId` (e.g. `get_listing`, `get_listings_by_shop`) and generated from the committed spec in `spec/`. Input schemas (enums, bounds, required/optional, arrays) come from the spec; path, query and body fields form one flat input set. Array query and form-urlencoded body values are sent comma-joined (e.g. `listing_ids=1,2,3`, `tags=blue,mug`); JSON bodies (e.g. `update_listing_inventory`) are sent as real JSON with nested objects and arrays. Regenerate with `npm run gen:local`.

### Toolsets

Every Tool belongs to exactly one Toolset: `listings`, `shop`, `shipping`, `orders`, `reviews`, `taxonomy`, `users` or `other`. Set `ETSY_TOOLSETS` to a comma-separated list (e.g. `ETSY_TOOLSETS=listings,orders`) to offer only those Toolsets' Tools; unset offers all. An unknown or empty value fails at startup with the list of valid names.

### File uploads

`upload_listing_image` (`image`), `upload_listing_file` (`file`) and `upload_listing_video` (`video`) take an **absolute local file path** in that field (relative paths and `~` are rejected). The server reads the file and sends it as multipart with the original filename. The field stays optional where the Etsy spec says so (e.g. `upload_listing_image` with only `listing_image_id` reads no file). A missing or unreadable path returns a Tool error and no request is sent to Etsy. These are Write Tools, so they need `ETSY_ALLOW_WRITES=true`. **Security:** with writes enabled the agent can upload any file the server process can read (for example `~/.config/etsy-mcp/tokens.json`), so only enable writes for agents you trust with that access.

### Read-only Mode and Write Tools

By default the server is in Read-only Mode: only the 64 GET Tools plus `token_scopes` (a POST that changes nothing) are offered. Set `ETSY_ALLOW_WRITES=true` to also offer Write Tools (every other POST, PUT, PATCH and DELETE Operation). Any value other than `true`/`false` fails at startup. Note that with writes enabled the upload Tools let the agent upload any file the server process can read.

Every Tool carries MCP annotations: `openWorldHint: true` on all; `readOnlyHint: true` on GETs and `token_scopes`; for Write Tools `readOnlyHint: false`, `destructiveHint: true` only for DELETE, and `idempotentHint: true` for PUT and DELETE.

## Authentication

Public Operations need only `ETSY_API_KEY` and `ETSY_SHARED_SECRET`; they never touch an OAuth token. Operations that require OAuth (e.g. `get_shop_receipts`) send `Authorization: Bearer <access token>`.

### Login

Run `npx @artisanxl/etsy-mcp login` (with `ETSY_API_KEY` set) once to authorize in your browser. It uses OAuth 2.0 Authorization Code with PKCE (S256) and a `state` check, listens on `http://localhost:3003/callback` for the redirect, and saves the tokens below. Register that exact redirect URI in your Etsy app; set `ETSY_REDIRECT_PORT` to use another port. By default it requests every scope used by any Operation; narrow it with `--scopes` (unknown scope names are rejected), e.g. `login --scopes listings_r,shops_r`. If the browser cannot be opened, the authorize URL is printed to stderr. Running `etsy-mcp` with no subcommand starts the MCP server. A `login` result is never overwritten by a stale `ETSY_REFRESH_TOKEN` on later server starts.

Tokens live in `~/.config/etsy-mcp/tokens.json` (`{access_token, refresh_token, expires_at, seed_sha256?}`, `expires_at` in epoch milliseconds; mode 0600). The server refreshes the access token 60 seconds before it expires and once after a 401, and always saves the new token pair (Etsy may rotate refresh tokens). For headless use set `ETSY_REFRESH_TOKEN`: it seeds the token file only when the file is absent, or when the file was itself seeded from a different `ETSY_REFRESH_TOKEN` value. A file without `seed_sha256` (for example one written by `login`) always wins over the environment value, and is then marked as seeded. The file records a SHA-256 of the seeded value (`seed_sha256`, never the raw token), so a rotated refresh token is not overwritten by the stale environment value on restart; to re-seed an already-seeded file, set a new `ETSY_REFRESH_TOKEN` value. If no token is available the Tool returns an error telling you to run `npx @artisanxl/etsy-mcp login`; a 403 adds a hint to re-run `login` with the needed scopes.

`ETSY_ACCESS_TOKEN` is no longer supported; if set, a warning is printed to stderr and it is ignored.

## Development

```sh
npm install
npm run build
```

Releases are published to npm automatically via trusted publishing (OIDC, with provenance) when a GitHub Release is published.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
