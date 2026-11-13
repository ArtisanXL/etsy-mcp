# @artisanxl/etsy-mcp

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
        "ETSY_ACCESS_TOKEN": "optional-oauth-token"
      }
    }
  }
}
```

Claude Code:

```sh
claude mcp add etsy -e ETSY_API_KEY=your-keystring -- npx -y @artisanxl/etsy-mcp
```

## Tools

- `get_shop` — shop by `shop_id`
- `find_shops` — search shops by name
- `get_listing` — listing by `listing_id`
- `search_listings` — search active listings
- `get_shop_listings` — active listings of a shop

## Development

```sh
npm install
npm run build
npm publish   # publishes as public scoped package
```

## License

MIT
