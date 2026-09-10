# Onboarding Paymod (for humans)

A walkthrough for the person setting up Paymod for the first time, not the agent. If you're an agent, read `/SKILL.md` instead.

## 1. Create your account

Go to `/signup` and create an account with your email and a password. Every account belongs to exactly one user. There is no team or membership model.

## 2. Create an Agent Wallet

From `/dashboard/wallets`, click **Create Agent Wallet**, name it and submit. Paymod provisions a real wallet on Circle's Developer-Controlled Wallets in that same request - no browser extension, no signature, nothing to wait on. Each wallet has its own isolated balance and address.

Fund the wallet from its detail page (`/dashboard/wallets/:id`): copy its address and send USDC to it from any wallet or exchange you already control. There is no Paymod-signed funding step.

## 3. Set policy

Your real, changeable spend rules live on `/dashboard/policies` and matter most **scoped to the wallet you just created**: an account-wide rule alone narrows a wallet's authority but never grants it, so a wallet with no wallet-scoped budget rule denies every transfer by default.

- **Daily limit** / **Monthly limit**: how much can move in a rolling window.
- **Per-transaction limit**: the largest single payment allowed.
- **Approval threshold**: payments above this amount wait for a human, instead of settling automatically.
- **X402 max autopay**: the ceiling for an agent paying paywalled resources without a human in the loop.
- Asset / network / destination / action allow- and blocklists.

Give at least one of **Daily limit**, **Monthly limit** or **Per-transaction limit** the wallet's own scope, not "Account-wide". That is what actually authorizes it to spend.

## 4. Generate a credential and hand it to your agent

From the wallet's row on `/dashboard/wallets` (or its detail page), click **Generate API key** to produce a `pm_live_...` secret. It is shown exactly once. Copy it immediately. Each credential is bound to the one wallet it was generated for.

Give that secret to your agent along with a link to `/QUICKSTART.md` or `/SKILL.md` and it can start requesting payments under the policy you just configured.

## 5. Connect Telegram for approvals

If you configured an approval threshold, open `/dashboard/settings` and select **Connect Telegram**. The one-time link connects the account to the Paymod bot. Only that linked Telegram chat can approve or deny a waiting transfer. Telegram is an approval surface, not a wallet key.

## 6. Watch it work

`/dashboard/activity` shows every policy decision and settlement, append-only.
