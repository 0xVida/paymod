# Paymod Skill

You have been given a Paymod credential (`pm_live_...`) so you can request money movement under a human-configured policy. Read this whole file before making your first call.

## What you can do

- Move USDC: `POST /v1/transfers`.
- Pay for a paywalled (x402) resource automatically: `POST /v1/x402/fetch`.
- Check remaining budget before spending: `GET /v1/budget`.
- Check your wallet's balance: `GET /v1/wallet/balance`.
- Look up a past request's outcome: `GET /v1/intents/:id`.

Your credential is bound to exactly one Agent Wallet. You cannot change policy or create other wallets. Those are human-only actions in the dashboard.

## How to call it

Prefer MCP if you have it available: ask to be connected to a `paymod` MCP server with your `PAYMOD_API_KEY`, then use the tools `paymod_get_balance`, `paymod_get_budget`, `paymod_transfer`, `paymod_get_request_status`, `paymod_pay_x402` directly, no HTTP details to manage.

Otherwise, call the REST API directly. Base URL and full reference: `/API_GUIDE.md`.

```
Authorization: Bearer pm_live_...
Idempotency-Key: <a UUID you generate, unique per logical request>
Content-Type: application/json
```

## The one rule that matters: idempotency

Every write needs an `Idempotency-Key`. Generate ONE key per logical request and reuse it on every retry of that same request: network errors, timeouts and 5xx responses are all safe to retry with the same key. Paymod replays the original result rather than moving money twice. Generating a NEW key for a retry is the mistake that causes a double payment. Do not do that.

## Reading a response

```json
{ "status": "AUTHORIZED", "intentId": "int_..." }
```

- `AUTHORIZED`: settling now. If you need the final on-chain result, poll `GET /v1/intents/:id` (a few seconds is normal).
- `WAITING_APPROVAL`: parked for a human. Nothing moved. For transfers, the account holder can approve or deny it from their linked Telegram chat. Do not retry it yourself.
- `DENIED`: nothing moved and retrying the identical request will not change that. Look at `reason` (a stable code like `DAILY_LIMIT_EXCEEDED`, `PER_TRANSACTION_LIMIT_EXCEEDED`, `DESTINATION_BLOCKED`) and either ask the user to adjust policy or don't attempt this payment again this session.

## Before a large or uncertain request

Call `GET /v1/budget` first. If the amount you're about to request exceeds `availableAtomic` for the relevant window, it will be denied. Don't burn a request finding that out, check first.

## x402 (paying for paywalled resources)

Call `POST /v1/x402/fetch` with `{"url": "..."}` instead of fetching the URL yourself. Paymod handles the 402 challenge, price check against policy, payment and retry in one call and returns the resource body directly on success. If the result is `WAITING_APPROVAL`, x402 resumption is not available yet: tell the user and do not retry the same resource request automatically.

## Money is always an atomic integer string

`"1000000"`, never `1000000` or `0.1`. Circle USDC is 6 decimals. Never send or parse a float for an amount.
