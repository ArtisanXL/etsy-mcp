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
        "ETSY_SHARED_SECRET": "your-shared-secret",
        "ETSY_ACCESS_TOKEN": "optional-oauth-token"
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

One Tool per Etsy Open API v3 GET Operation (64), named as the snake_case `operationId` (e.g. `get_listing`, `get_listings_by_shop`) and generated from the committed spec in `spec/`. Array query parameters are not yet supported. Regenerate with `npm run gen:local`.

## Development

```sh
npm install
npm run build
```

Releases are published to npm automatically via trusted publishing (OIDC, with provenance) when a GitHub Release is published.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT
