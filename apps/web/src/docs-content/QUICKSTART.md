# Paymod Quickstart

Paymod is programmable financial authority for AI agents: an agent calls Paymod when an action needs money, Paymod checks it against policy and either settles it, escalates it to a human or refuses it.

## 1. Get a credential

A human sets up an account, creates an Agent Wallet for you and sets at least one wallet-scoped budget policy from the [dashboard](/dashboard). They hand you a `pm_live_...` secret, shown to them once, at creation and never recoverable after. Do not ask for it twice; if it's lost, ask them to generate a new one.

## 2. Move money

```bash
curl -X POST __PAYMOD_API_BASE_URL__/v1/transfers \
  -H "Authorization: Bearer pm_live_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"amount":"1000000","destination":"0x...","purpose":"api credits"}'
```

`amount` is an atomic integer string. Decimals depend on the wallet's rail: Circle USDC is 6 decimals, so `100000` is 0.1 USDC. Never send a float.

The response is one of:

- `{"status":"AUTHORIZED","intentId":"int_..."}`: settling now. Poll `GET /v1/intents/:id` for the on-chain result.
- `{"status":"WAITING_APPROVAL","intentId":"int_...","reason":"..."}`: a human needs to approve it. Nothing has moved. Transfers can be approved from the account's linked Telegram chat.
- `{"status":"DENIED","reason":"DAILY_LIMIT_EXCEEDED"}` (or another policy reason code): nothing moved and it never will for this request. Don't retry with the same parameters.

Retrying the identical request with the identical `Idempotency-Key` is always safe. Paymod replays the original result rather than double-spending.

## 3. Check your budget before spending

```bash
curl __PAYMOD_API_BASE_URL__/v1/budget -H "Authorization: Bearer pm_live_..."
```

Returns remaining daily/monthly headroom. Check this before a large request if you want to avoid a denial.

## 4. Prefer MCP or the SDK if you can

If you're running as a Claude Desktop-style agent, ask to be connected to the Paymod MCP server instead of calling curl directly (see `/SKILL.md`). If you're a Node/TypeScript agent, use `@paymod/sdk` instead of hand-rolling HTTP calls (see `/API_GUIDE.md`).
