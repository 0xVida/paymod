#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
contract_dir="$(cd "$script_dir/.." && pwd)"

if ! command -v stellar >/dev/null 2>&1; then
  printf 'The Stellar CLI is required. Install it with: cargo install --locked stellar-cli\n' >&2
  exit 1
fi

if [[ ! -f "$contract_dir/.env" ]]; then
  printf 'Copy .env.example to .env and set the Testnet key names before deploying.\n' >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$contract_dir/.env"

: "${STELLAR_NETWORK:?STELLAR_NETWORK is required}"
: "${PAYMOD_TESTNET_USDC_CONTRACT_ID:?PAYMOD_TESTNET_USDC_CONTRACT_ID is required}"
: "${CUSTOMER_OWNER_KEY_NAME:?CUSTOMER_OWNER_KEY_NAME is required}"
: "${PAYMOD_EXECUTOR_KEY_NAME:?PAYMOD_EXECUTOR_KEY_NAME is required}"

"$script_dir/build-wasm.sh"

wasm="$contract_dir/target/wasm32v1-none/release/paymod_treasury.wasm"
owner_address="$(stellar keys address "$CUSTOMER_OWNER_KEY_NAME")"
executor_address="$(stellar keys address "$PAYMOD_EXECUTOR_KEY_NAME")"

contract_id="$(stellar contract deploy \
  --wasm "$wasm" \
  --source-account "$CUSTOMER_OWNER_KEY_NAME" \
  --network "$STELLAR_NETWORK")"

# NOTE: this invocation predates ADR 0008's executor_public_key parameter
# (required for x402's __check_auth path) and is missing --executor-public-key;
# it was already stale before this contract-hardening pass and is not fixed
# here. tools/paymod-testnet/paymod-testnet.mjs is the current, correct
# deploy path; prefer it over this script.
stellar contract invoke \
  --id "$contract_id" \
  --source-account "$CUSTOMER_OWNER_KEY_NAME" \
  --network "$STELLAR_NETWORK" \
  -- initialize \
  --owner "$owner_address" \
  --executor "$executor_address" \
  --token "$PAYMOD_TESTNET_USDC_CONTRACT_ID" \
  --max-per-payment 2000000 \
  --max-per-period 20000000 \
  --period-seconds 86400 \
  --authority-expires-at 0

printf 'Deployed and initialized Treasury Contract: %s\n' "$contract_id"
printf 'Fund this address with Testnet USDC before executing payments.\n'
