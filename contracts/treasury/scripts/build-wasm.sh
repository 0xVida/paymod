#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
contract_dir="$(cd "$script_dir/.." && pwd)"

cd "$contract_dir"
cargo build --target wasm32v1-none --release

printf 'WASM artifact: %s\n' "$contract_dir/target/wasm32v1-none/release/paymod_treasury.wasm"
