# @paymod/mcp-server

MCP server exposing Paymod as tools an AI agent can call directly:
`paymod_get_balance`, `paymod_get_budget`, `paymod_transfer`,
`paymod_get_request_status`, `paymod_pay_x402`. Every tool is a thin wrapper
over `@paymod/sdk`, which calls `apps/api`.

## Running

```sh
npm --workspace @paymod/mcp-server run build
PAYMOD_API_KEY=pm_live_... PAYMOD_API_URL=http://localhost:3001 \
  npx tsx dist/index.js
```

`PAYMOD_API_URL` defaults to `http://localhost:3001` if unset.

## Remote MCP deployment

Set `PAYMOD_MCP_TRANSPORT=http` to serve a Streamable HTTP MCP endpoint at
`/mcp`. This mode does not use `PAYMOD_API_KEY`. Each MCP connection must send
the wallet-specific API credential as `Authorization: Bearer pm_live_...` on
every request. The service creates a separate Paymod client for that credential
and does not log or persist it.

Render configuration:

```text
Service type: Web Service
Root directory: apps/mcp-server
Build command: cd ../.. && npm install && npm --workspace @paymod/mcp-server run build
Start command: cd ../.. && npm --workspace @paymod/mcp-server run start
Health check path: /health
Environment:
  PAYMOD_MCP_TRANSPORT=http
  PAYMOD_API_URL=https://your-paymod-api.onrender.com
```

After deployment, configure your MCP client with
`https://your-mcp-service.onrender.com/mcp` and the `Authorization` header.
Do not put a `PAYMOD_API_KEY` in the Render environment for this service.

## Why this always runs through `tsx dist/index.js`, never bare `node`

`@paymod/sdk` and `@paymod/shared` are TypeScript-source-only packages
(`exports: "./src/index.ts"`, no build step). This is the same pattern used
throughout the monorepo. Node's module loader can't resolve a `.ts` import on
its own, so the compiled `dist/index.js` must run through `tsx`, which
resolves those sibling packages at import time. This is the same reason
`apps/api` runs `tsx dist/main.js` instead of `node dist/main.js`.

## Claude Desktop configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paymod": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/paymod/apps/mcp-server/dist/index.js"],
      "env": {
        "PAYMOD_API_KEY": "pm_live_...",
        "PAYMOD_API_URL": "http://localhost:3001"
      }
    }
  }
}
```

Run `npm --workspace @paymod/mcp-server run build` first so `dist/index.js`
exists. Restart Claude Desktop after editing the config.

## Testing

```sh
npm --workspace @paymod/mcp-server run test              # unit tests only
PAYMOD_MCP_LIVE=1 PAYMOD_API_KEY=pm_live_... PAYMOD_API_URL=http://localhost:3001 \
  npm --workspace @paymod/mcp-server run test             # + live suite
```

The live suite (`src/mcp-live.test.ts`) spawns the built server exactly as
Claude Desktop would and drives it over real stdio: lists all five tools,
checks budget then sends a real testnet transfer, confirms an over-limit
transfer comes back as a structured `DENIED` result rather than a thrown
error and confirms an invalid credential surfaces as a structured tool
error. It requires a running `apps/api` against a funded Stellar Testnet
treasury and a real `pm_live_` credential.
