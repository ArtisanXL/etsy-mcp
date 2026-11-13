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

One Tool per Etsy Open API v3 GET Operation (64), named as the snake_case `operationId` (e.g. `get_listing`, `get_listings_by_shop`) and generated from the committed spec in `spec/`. Input schemas (enums, bounds, required/optional, arrays) come from the spec; array query parameters are sent comma-joined (e.g. `listing_ids=1,2,3`). Regenerate with `npm run gen:local`.

### Toolsets

Every Tool belongs to exactly one Toolset: `listings`, `shop`, `shipping`, `orders`, `reviews`, `taxonomy`, `users` or `other`. Set `ETSY_TOOLSETS` to a comma-separated list (e.g. `ETSY_TOOLSETS=listings,orders`) to offer only those Toolsets' Tools; unset offers all. An unknown or empty value fails at startup with the list of valid names.

## Authentication

Public Operations need only `ETSY_API_KEY` and `ETSY_SHARED_SECRET`; they never touch an OAuth token. Operations that require OAuth (e.g. `get_shop_receipts`) send `Authorization: Bearer <access token>`.

Tokens live in `~/.config/etsy-mcp/tokens.json` (`{access_token, refresh_token, expires_at}`, `expires_at` in epoch milliseconds; mode 0600). The server refreshes the access token 60 seconds before it expires and once after a 401, and always saves the new token pair (Etsy may rotate refresh tokens). For headless use set `ETSY_REFRESH_TOKEN`: it seeds the token file when the file is absent or holds a different refresh token. If no token is available the Tool returns an error telling you to run `npx @artisanxl/etsy-mcp login`; a 403 adds a hint to re-run `login` with the needed scopes.

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
