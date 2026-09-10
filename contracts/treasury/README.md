# Paymod Stellar Treasury Contract

This is an isolated Stellar Testnet feasibility spike. It is not production
custody software and must not receive production funds.

The contract is a customer-funded USDC vault:

```text
Customer owner
  ├── funds, withdraws, pauses and revokes the executor
  └── never gives its key to Paymod

Paymod executor
  └── submits payments that satisfy the contract's hard limits

Relayer / fee payer
  └── can submit the transaction and pay network fees when it attaches the
      executor's Soroban authorization entry
```

## Contract controls

- One configured SEP-41 token (Testnet USDC in the spike).
- Per-payment cap.
- Period spending cap.
- Emergency pause.
- Owner withdrawal.
- Executor rotation/revocation.
- Idempotency identifier per payment.

## Local verification

Requires Rust 1.91+ and the Soroban SDK dependencies.

```sh
cargo fmt --check
cargo test
bash scripts/build-wasm.sh
```

## Testnet prerequisites

Install the Stellar CLI and the WASM target:

```sh
rustup target add wasm32v1-none
cargo install --locked stellar-cli
```

Create three Testnet identities outside Paymod's application processes:

```text
customer-owner
paymod-executor
paymod-relayer
```

Fund the customer and relayer with Testnet XLM. The customer must establish a
USDC trustline and obtain Testnet USDC before funding the deployed vault.

## Testnet runbook

1. Build the WASM artifact.
2. Deploy it from the customer owner identity.
3. Initialize it with the customer owner address, Paymod executor address,
   Testnet USDC contract address and atomic limits.
4. Transfer Testnet USDC into the Treasury Contract address.
5. Have the executor submit an `execute_payment` transaction or have a
   relayer submit one with an attached executor Soroban authorization entry.
6. Exercise pause, executor rotation, duplicate payment ID and owner withdrawal.

After copying `.env.example` to `.env`, deployment is performed with:

```sh
bash scripts/deploy-testnet.sh
```

The Testnet scripts should be executed only with disposable keys. They are not a
substitute for a production signing design or contract security audit.

## Verified Testnet receipt (disposable accounts)

The following deployment is a reproducible feasibility record, not a stable
environment or production contract:

- Treasury contract: `CCQBVEGLHCXPJUDRP7D5XLHSDG34L5PFYUAJWDTK3FYGHUDY7OWJV4GD`
- USDC funded into the vault: `5.0000000` USDC
- Executor-authorized Treasury payment: `0.1000000` USDC
- Payment transaction: `ed70be83dc74a0eb08973cb923a67e05eaaaec0da74b5d7fdbf7bb98c9607c46`
- Relayer-paid payment with executor auth entry:
  `e5288fa44a00594fdcf2e692f1401a229ae6de703a25a2aeb3a81a3278e3ab32`
- Owner executor rotation:
  `1225180985af2f532796cd316ef121af02427cc133e48890151ccdfa50229698`
- Owner recovery withdrawal of the remaining `4.8000000` USDC:
  `5d3e0dd9fe063764a6210956d35f7df6ae6d2e505176bd754592184e0ffc111e`
- Duplicate-payment simulation: rejected with contract error `#8`
  (`PaymentAlreadyExecuted`)

The owner pause/unpause control was also exercised. The SDK relayer harness
proved a transaction can use the relayer as source and fee payer while the
executor supplies only the separately signed authorization entry. After owner
rotation, that old executor was no longer requested by the contract simulation.
