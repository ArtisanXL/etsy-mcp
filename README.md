# @artisanxl/etsy-mcp

[![npm](https://img.shields.io/npm/v/@artisanxl/etsy-mcp)](https://www.npmjs.com/package/@artisanxl/etsy-mcp)
[![CI](https://github.com/ArtisanXL/etsy-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ArtisanXL/etsy-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

MCP server for the [Etsy Open API v3](https://developers.etsy.com/documentation/).

## Quick start

1. Create an app at <https://www.etsy.com/developers/your-apps> and note its **keystring** (`ETSY_API_KEY`) and **shared secret** (`ETSY_SHARED_SECRET`).
2. Add the server to your MCP client:

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

That is enough for public data (listings, shops, taxonomy, reviews). For your own shop's data (receipts, inventory, ...) run [`login`](#login) once. To let the agent change your shop, set `ETSY_ALLOW_WRITES=true`.

Upgrading from 0.1.x? See the [CHANGELOG](CHANGELOG.md) for renamed Tools and removed settings.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ETSY_API_KEY` | yes | | Your Etsy app keystring. Also the OAuth `client_id` for `login`. |
| `ETSY_SHARED_SECRET` | yes (server) | | Your Etsy app shared secret. Every request sends `x-api-key: keystring:shared_secret`. `login` does not need it. |
| `ETSY_TOOLSETS` | no | all Toolsets | Comma-separated [Toolsets](#toolsets) to offer. An unknown or empty value fails at startup. |
| `ETSY_ALLOW_WRITES` | no | `false` | `true` offers [Write Tools](#read-only-mode-and-write-tools); anything other than `true`/`false` fails at startup. |
| `ETSY_REFRESH_TOKEN` | no | | Seeds the token file for headless use, see [Authentication](#authentication). |
| `ETSY_REDIRECT_PORT` | no | `3003` | Port of the `login` callback (`http://localhost:<port>/callback`). Only `login` reads it. |
| `ETSY_ACCESS_TOKEN` | removed | | No longer supported; if set, a warning is printed to stderr and it is ignored. |

The server does not load `.env` files; set variables in your MCP client's `env` block or your shell. [`.env.example`](.env.example) lists all of them.

## Tools

One Tool per Etsy Open API v3 Operation (107), named as the snake_case `operationId` (e.g. `get_listing`, `get_listings_by_shop`) and generated from the Etsy spec committed in `spec/`. Input schemas (enums, bounds, required/optional, arrays) come from the spec; path, query and body fields form one flat input set. Array query and form-urlencoded body values are sent comma-joined (e.g. `listing_ids=1,2,3`, `tags=blue,mug`); JSON bodies (e.g. `update_listing_inventory`) are sent as real JSON with nested objects and arrays. Successful responses are returned as the raw JSON text; non-2xx responses are Tool errors with the HTTP status and body. `limit`/`offset` are passed through as-is, there is no auto-pagination.

### Toolsets

Every Tool belongs to exactly one Toolset. Set `ETSY_TOOLSETS` (e.g. `ETSY_TOOLSETS=listings,orders`) to offer only those; unset offers all.

| Toolset | Tools | Etsy tags |
| --- | --- | --- |
| `listings` | 41 | all `ShopListing*` |
| `shop` | 20 | Shop, Shop Section, Shop Return Policy, Shop ProductionPartner, Shop Economic Operators |
| `shipping` | 21 | Shop ShippingProfile, Shop ProcessingProfiles, Shop HolidayPreferences |
| `orders` | 13 | Shop Receipt, Shop Receipt Transactions, Payment, Ledger Entry |
| `reviews` | 2 | Review |
| `taxonomy` | 4 | BuyerTaxonomy, SellerTaxonomy |
| `users` | 4 | User, UserAddress |
| `other` | 2 | Other |

### Read-only Mode and Write Tools

By default the server is in Read-only Mode: only the 64 GET Tools plus `token_scopes` (a POST that changes nothing) are offered, 65 in total. Set `ETSY_ALLOW_WRITES=true` to also offer the 42 Write Tools (every other POST, PUT, PATCH and DELETE Operation).

Every Tool carries MCP annotations: `openWorldHint: true` on all; `readOnlyHint: true` on GETs and `token_scopes`; for Write Tools `readOnlyHint: false`, `destructiveHint: true` only for DELETE, and `idempotentHint: true` for PUT and DELETE.

### File uploads

`upload_listing_image` (`image`), `upload_listing_file` (`file`) and `upload_listing_video` (`video`) take an **absolute local file path** in that field (relative paths and `~` are rejected). The server reads the file and sends it as multipart with the original filename. The field stays optional where the Etsy spec says so (e.g. `upload_listing_image` with only `listing_image_id` reads no file). A missing or unreadable path returns a Tool error and no request is sent to Etsy. These are Write Tools, so they need `ETSY_ALLOW_WRITES=true`. **Security:** with writes enabled the agent can upload any file the server process can read (for example `~/.config/etsy-mcp/tokens.json`), so only enable writes for agents you trust with that access.

### Rate limits

A 429 response is retried up to 3 times per Tool call, waiting the `Retry-After` value (default 1s if absent; a `Retry-After` of at most 60s is waited, a longer one is not retried, see below); after that the 429 is returned as a Tool error. A 429 is treated as daily-quota exhaustion and returned immediately without retrying when it carries `x-remaining-today: 0` or a `Retry-After` longer than 60s; the error then says retrying will not help. Cancelling the MCP request aborts the wait and stops retrying.

## Authentication

Public Operations (31 of 107) need only `ETSY_API_KEY` and `ETSY_SHARED_SECRET`; they never touch an OAuth token. The 76 Operations that require OAuth (e.g. `get_shop_receipts`) send `Authorization: Bearer <access token>`.

### Login

Etsy app setup: in your app's settings on Etsy, register the redirect URI `http://localhost:3003/callback` (or `http://localhost:<port>/callback` if you set `ETSY_REDIRECT_PORT`). It must match exactly.

Then run `ETSY_API_KEY=your-keystring npx @artisanxl/etsy-mcp login` once to authorize in your browser. It uses OAuth 2.0 Authorization Code with PKCE (S256) and a `state` check, and saves the tokens below. If the browser cannot be opened, the authorize URL is printed to stderr. By default it requests every scope used by any Operation (`address_r`, `email_r`, `listings_d`, `listings_r`, `listings_w`, `shops_r`, `shops_w`, `transactions_r`, `transactions_w`); narrow it with `--scopes` (unknown scope names are rejected), e.g. `login --scopes listings_r,shops_r`. Running `etsy-mcp` with no subcommand starts the MCP server.

### Tokens

Tokens live in `~/.config/etsy-mcp/tokens.json` (`{access_token, refresh_token, expires_at, seed_sha256?}`, `expires_at` in epoch milliseconds; mode 0600). The server refreshes the access token 60 seconds before it expires and once after a 401, and always saves the new token pair (Etsy may rotate refresh tokens).

For headless use (CI, containers) set `ETSY_REFRESH_TOKEN` instead of running `login`: it seeds the token file only when the file is absent, or when the file was itself seeded from a different `ETSY_REFRESH_TOKEN` value. A file without `seed_sha256` (for example one written by `login`) always wins over the environment value and is then marked as seeded. The file records a SHA-256 of the seeded value (`seed_sha256`, never the raw token), so a rotated refresh token is not overwritten by the stale environment value on restart; to re-seed an already-seeded file, set a new `ETSY_REFRESH_TOKEN` value.

If an Operation needs OAuth and no token is available, the Tool returns an error telling you to run `npx @artisanxl/etsy-mcp login`; a 403 adds a hint to re-run `login` with the needed scopes.

## Maintaining the spec

Regenerate the Tools offline from the Spec Snapshot with `npm run gen:local`; `npm run gen` first downloads the latest Etsy spec into the Snapshot, then runs `gen:local`. Generated output is committed and CI fails if `gen:local` changes it. A weekly GitHub Action (`spec-refresh`) runs `npm run gen` and opens a PR when anything changed (and closes it again if the snapshot is back in sync). Without a `SPEC_REFRESH_TOKEN` secret (a PAT) it uses `GITHUB_TOKEN`: the repo setting "Allow GitHub Actions to create and approve pull requests" must be enabled, and refresh PRs won't trigger CI. See [ADR 0001](docs/adr/0001-generate-tools-from-spec-snapshot.md).

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Releases are published to npm automatically via trusted publishing (OIDC, with provenance) when a GitHub Release is published.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
