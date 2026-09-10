# Paymod API Guide

Base URL: `__PAYMOD_API_BASE_URL__`

Every endpoint is under `/v1`. Amounts are always atomic integer strings, never floats. Decimals depend on the wallet's rail: Circle USDC is 6 decimals, so `100000` is 0.1 USDC.

## Authentication

Two credential types:

- **Wallet credential**: `Authorization: Bearer pm_live_...`. What an agent uses for every financial call, bound to exactly one Agent Wallet. Generated once, from the dashboard or `POST /v1/wallets/:id/credentials` and shown exactly once.
- **Session cookie**: set by `POST /v1/auth/login`, used by the dashboard. Not relevant to an agent calling the API directly.

## Financial intents (wallet credential)

### `POST /v1/transfers`

Request a transfer. Requires an `Idempotency-Key` header: replaying the same key with the same body returns the cached response; the same key with a different body is a `409 IDEMPOTENCY_CONFLICT`.

```json
// Request
{ "amount": "1000000", "destination": "0x...", "purpose": "optional" }

// Response
{ "requestId": "req_...", "intentId": "int_...", "status": "AUTHORIZED" | "WAITING_APPROVAL" | "DENIED", "reason": "..." }
```

### `GET /v1/intents/:id`

Look up an intent's policy decision and, once settled, its on-chain transaction hash.

### `GET /v1/budget`

Remaining daily/monthly budget windows for the calling wallet:

```json
{ "windows": [{ "window": "DAY", "limitAtomic": "...", "spentAtomic": "...", "reservedAtomic": "...", "availableAtomic": "..." }] }
```

### `GET /v1/wallet/balance`

The calling wallet's own live balance: `{ "assetCode": "USDC", "available": "..." }`.

### `POST /v1/x402/fetch`

Fetch a URL that may be paywalled with the x402 protocol. If it returns 402, Paymod checks the price against policy, pays from the wallet if authorized and retries, all in one call.

```json
// Request
{ "url": "https://example.com/paywalled-resource" }

// Response (one of)
{ "status": "FETCHED_DIRECTLY", "httpStatus": 200, "body": "..." }
{ "status": "COMPLETED", "intentId": "int_...", "txHash": "...", "amountAtomic": "...", "body": "..." }
{ "status": "DENIED" | "WAITING_APPROVAL" | "FAILED" | "UNKNOWN", "intentId": "int_...", "reason": "..." }
```

`WAITING_APPROVAL` is not resumable for x402 yet. The reservation expires safely if it is not settled.

## Account management (session or bootstrap token)

These are dashboard-facing, not typically called by an agent directly.

| Endpoint | Method | Notes |
| --- | --- | --- |
| `/v1/policies?accountId=` | GET / PUT | List or upsert spend rules, optionally scoped to a wallet via `walletId`. |
| `/v1/wallets?accountId=` | GET / POST | List or create Agent Wallets. |
| `/v1/wallets/:id?accountId=` | GET | A single wallet's status and address. Provisions synchronously on creation - there is no separate activation step. |
| `/v1/wallets/:id/balance?accountId=` | GET | That wallet's live balance. |
| `/v1/wallets/:id/credentials` | POST | Issue a new credential for a wallet. |
| `/v1/audit?accountId=` | GET | Append-only audit log for the account. |
| `/v1/approvals/telegram` | GET / DELETE | Read or disconnect the account-linked Telegram approval chat. |
| `/v1/approvals/telegram/link` | POST | Create a one-time Telegram connection link. |

## Auth

`POST /v1/auth/signup`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/auth/me`.

## Error shape

```json
{ "error": { "code": "DAILY_LIMIT_EXCEEDED", "message": "...", "requestId": "...", "details": {} } }
```

`code` is a stable, machine-readable string. Branch on it, not on `message`. Common codes: `INVALID_CREDENTIAL`, `ACCOUNT_SUSPENDED`, `WALLET_PAUSED`, `WALLET_NOT_READY`, `NO_SPENDING_POLICY`, `DAILY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED`, `PER_TRANSACTION_LIMIT_EXCEEDED`, `APPROVAL_REQUIRED`, `WALLET_UNVERIFIED`, `INSUFFICIENT_TREASURY_BALANCE`, `IDEMPOTENCY_CONFLICT`, `X402_UNSUPPORTED_NETWORK`, `X402_UNSUPPORTED_ASSET`, `SSRF_BLOCKED`.
