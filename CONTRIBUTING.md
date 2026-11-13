# Contributing

Thanks for your interest in improving etsy-mcp!

## Setup

```sh
git clone https://github.com/ArtisanXL/etsy-mcp.git
cd etsy-mcp
npm install
npm run build
```

Test locally with an MCP client by pointing it at `node /path/to/etsy-mcp/dist/index.js`
and setting `ETSY_API_KEY`.

## Pull Requests

1. Fork and create a branch from `main`.
2. Keep changes focused; one feature/fix per PR.
3. Make sure `npm run typecheck` and `npm run build` pass.
4. Update `README.md` and `CHANGELOG.md` when behavior changes.

Never commit API keys or tokens. Use environment variables or a local `.env` (git-ignored).

By contributing you agree that your contributions are licensed under the MIT License.
