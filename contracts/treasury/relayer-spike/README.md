# Relayer Auth-Entry Spike

This disposable Testnet harness validates Paymod's intended submission model:

1. The executor signs a narrowly scoped Soroban auth entry for one payment.
2. The relayer rebuilds the transaction using its own account as source.
3. The relayer re-simulates in enforcing mode, signs the transaction envelope,
   pays the XLM fee and submits it.

The customer owner is not involved in this path and its secret must never be
provided to this script.

## Run

```sh
cp .env.example .env
# Fill `.env` with disposable Testnet values, then load it into your shell.
set -a; source .env; set +a
npm run testnet:relay
```

For an operator-managed key store, set `PAYMOD_EXECUTOR_SECRET_FILE` and
`PAYMOD_RELAYER_SECRET_FILE` to files that each contain one secret rather than
loading secrets into shell environment variables.

The payment ID is an idempotency key and must be a fresh 32-byte hex value.
This is Testnet-only plumbing, not a production signer or security-audited
relayer service.
