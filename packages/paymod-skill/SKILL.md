---
name: paymod
description: Use Paymod to inspect a funded agent wallet, request policy-controlled transfers or x402 payments and handle Telegram approval outcomes.
---

# Paymod

Use Paymod when an agent needs to spend from its assigned wallet. Paymod is a policy gate, not a general-purpose signing wallet.

## Before requesting payment

- Read the wallet balance and available budget.
- State the recipient, human amount, asset and purpose before requesting a transfer.
- Do not convert human amounts to floating point. Paymod API amounts are atomic integer strings. Stellar USDC has 7 decimals, so `0.10 USDC` is `"1000000"`.
- Do not ask for or handle the wallet owner key. Use the wallet API credential or OAuth MCP connection only.

## Transfers

Request a transfer with an idempotency key when the caller may retry. Treat outcomes distinctly:

- `AUTHORIZED`: settlement is underway. Read the request status before claiming completion.
- `WAITING_APPROVAL`: tell the user that a Telegram approval was requested. Poll with `waitForRequest` or the MCP wait tool.
- `DENIED`: report the policy reason and do not retry with a different amount unless the user changes policy or gives a new instruction.

## x402 resources

Use the x402 payment action only for a specific URL the user asked to access.

- A direct fetch means no payment was needed.
- A completed payment returns the protected resource.
- If it waits for approval, use the returned intent ID to wait. Once complete, retrieve the resource with the x402-result action.
- Never turn an x402 request into a normal transfer. The x402 handshake binds the payment to the merchant and resource.

## Human approval

Telegram approval is asynchronous. Do not state that funds moved when the result is `WAITING_APPROVAL`.

After approval, wait for a terminal result. Report the transaction hash only once the request is completed or confirmed.

## Safety boundaries

- Respect `DENIED`, `PAUSED`, `ARCHIVED` and budget-limit outcomes.
- Do not retry an `UNKNOWN` settlement blindly. Ask Paymod for the request status and let its reconciliation process resolve the chain outcome.
- Never expose raw API credentials in chat output, source control or logs.
