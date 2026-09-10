# Paymod

**Programmable financial authority for AI agents.**

Paymod gives autonomous agents controlled access to money. A deterministic
policy engine evaluates every intent an agent makes, human approval routes
through Telegram when a decision calls for it, and every outcome is written
to an audit trail. Agents run wherever they already run: Claude, ChatGPT,
OpenClaw, Cursor or custom code. They call Paymod when an action needs
money, and Paymod decides whether to allow it, require approval or deny it,
then settles through whichever rail the wallet uses.

> Give an AI agent money to work with, without giving it unlimited access to
> your wallet.

Paymod Code is a separate, pay-as-you-go coding agent for VS Code and the
terminal. It runs tools locally against your real project and bills through
a Paymod-managed inference proxy with live, metered usage. Your balance is
currently funded by Solana USDC deposits.

## Layout

```text
apps/web/               Next.js marketing site and wallet dashboard
apps/api/               NestJS wallet control plane and Paymod Code endpoints
apps/code-cli/          Paymod Code CLI
apps/code-extension/    Paymod Code VS Code extension
apps/mcp-server/        MCP server for Paymod Wallet / Payments
packages/code-core/     Host-agnostic local coding-agent runtime
packages/shared/        Atomic money, prefixed ULIDs, error codes
packages/policy-engine/ Pure allow / deny / require-approval evaluation
packages/payments/      Chain-neutral settlement interface
packages/database/      Prisma schema and atomic budget reservations
contracts/treasury/     Soroban treasury contract, dormant, kept for a future Stellar rail
tools/paymod-testnet/   Disposable-identity testnet operator CLI
```

## Getting started

```sh
npm install
npm run infra:up          # postgres:16 + redis:7
cp packages/database/.env.example packages/database/.env
npm run db:migrate
npm run db:generate

npm test
npm run typecheck
npm run dev:web
```

PostgreSQL **16 or newer** is required: budget periods rely on
`NULLS NOT DISTINCT`, which needs PostgreSQL 15 or newer.

## Two things worth knowing before you read the code

**Money is always an atomic integer string.** Never a float, never a JS
number. Decimals depend on the wallet's rail: 0.25 USDC on Circle (6
decimals) is `"250000"`. `@paymod/shared` enforces this at every boundary.

**Paymod is the policy, approval and audit layer in front of wallet
execution, not the wallet infrastructure itself.** For EVM-rail Agent
Wallets, Circle's Developer-Controlled Wallets are the execution and
custody layer underneath. Developer-Controlled Wallets have no built-in
policy engine of their own, which is exactly the gap Paymod fills. Other
rails, including a dormant Soroban treasury contract (`contracts/treasury/`),
are wallet infrastructure Paymod builds and runs directly. A Solana rail for
Paymod Wallet is planned next.
