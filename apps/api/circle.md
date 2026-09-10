# Circle Developer-Controlled Wallets setup

Paymod's wallet rail runs on Circle's Developer-Controlled Wallets, not
Circle's separate Agent Wallets product - see `packages/database/prisma/schema.prisma`'s
`AgentWallet` docblock for why that distinction matters. This file is the
runbook for the one-time setup and for rotating the entity secret later.

Everything here writes to `apps/api/.env` (gitignored, never commit it) and
two gitignored files this setup creates: `apps/api/circle-entity-public-key.pem`
and `apps/api/circle-recovery/`.

## What each credential is for

| Variable | What it is | How often it changes |
| --- | --- | --- |
| `CIRCLE_API_KEY` | Your Circle developer account's API key, from the [Circle Console](https://console.circle.com/) | Rotate whenever you want; independent of the rest |
| `CIRCLE_ENTITY_SECRET` | A 32-byte secret Circle ties to your account. Every wallet-creation and transfer call proves it knows this. | Rotate if it may have leaked - see below |
| `CIRCLE_ENTITY_PUBLIC_KEY_FILE` | Circle's own RSA public key, used to encrypt the entity secret before every request. Not secret - Circle hands it to anyone with an API key. | Effectively never |
| `CIRCLE_WALLET_SET_ID` | The wallet set every Paymod-created wallet belongs to. One wallet set for the whole product today, not one per customer. | Once, unless you deliberately split wallet sets later |
| `CIRCLE_BLOCKCHAIN` | Which chain wallets are created on (`BASE-SEPOLIA` for testnet) | Only when you move to a different chain or to mainnet |
| `CIRCLE_USDC_TOKEN_ID` | Circle's internal id for the specific USDC contract on whichever chain `CIRCLE_BLOCKCHAIN` names - **not a universal "Circle USDC" value.** Circle issues a separate USDC contract per chain (Base Sepolia's is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, Ethereum Sepolia's is different, mainnet's is different again), each with its own id. | Every time `CIRCLE_BLOCKCHAIN` changes, not just once ever |
| `CIRCLE_USDC_CONTRACT_ADDRESS` | The real on-chain address of that same USDC contract, from [Circle's own reference](https://developers.circle.com/stablecoins/usdc-contract-addresses) - not Circle's internal id above. Only used for x402: matching a merchant's `PaymentRequirements.asset` and as the EIP-712 `verifyingContract`. | Every time `CIRCLE_BLOCKCHAIN` changes |
| `CIRCLE_RPC_URL` | A read-only RPC endpoint for `CIRCLE_BLOCKCHAIN`, used only to check whether a stuck x402 payment's authorization was actually consumed on-chain. Optional - defaults to a public endpoint per chain. | Only if the default becomes unreliable |

## First-time setup

1. Create a [Circle Console](https://console.circle.com/) account and copy an API key into `apps/api/.env`:

   ```
   CIRCLE_API_KEY=your_key_here
   ```

2. Generate and register the entity secret:

   ```sh
   npx tsx apps/api/scripts/circle-register-entity-secret.ts
   ```

   This writes `CIRCLE_ENTITY_SECRET` into `.env` and saves a recovery file
   under `apps/api/circle-recovery/`. **Move that recovery file to a
   password manager or secrets vault immediately** - it is the only way to
   recover the secret if it is lost, and Circle cannot do it for you. The
   script refuses to run if `CIRCLE_ENTITY_SECRET` is already set, so it
   can't be run twice by accident.

3. Fetch Circle's public key:

   ```sh
   npx tsx apps/api/scripts/circle-fetch-public-key.ts
   ```

   Saves `apps/api/circle-entity-public-key.pem` and tells you to set
   `CIRCLE_ENTITY_PUBLIC_KEY_FILE=./circle-entity-public-key.pem` in `.env`
   if it isn't there already. `_FILE` is fine for local dev where the file
   actually exists on disk, but it's gitignored and never ships to a real
   deploy target (Railway, Render or anywhere else) - a hosted environment
   needs `CIRCLE_ENTITY_PUBLIC_KEY` set instead, with the `.pem`'s contents
   pasted directly as the value (`entity-secret.ts`'s `readSecret` checks
   the inline var first). The key itself isn't secret, so this is safe to
   paste straight into a hosting dashboard.

4. Create a wallet set:

   ```sh
   npx tsx apps/api/scripts/circle-create-wallet-set.ts "paymod-mvp"
   ```

   Prints the id to put in `CIRCLE_WALLET_SET_ID`.

5. Set `CIRCLE_BLOCKCHAIN` (defaults to `BASE-SEPOLIA` for testnet).

6. Find the USDC token id for **that specific chain** - whatever you just
   set `CIRCLE_BLOCKCHAIN` to in step 5, not USDC in general. This is the
   one step Circle does not expose through a lookup API - you need a wallet
   that has actually held the token first:
   - Set `CIRCLE_USDC_TOKEN_ID` to any placeholder non-empty string for now
     (wallet creation works without a valid one; only balance reads and
     transfers need the real value).
   - Start the API and create a wallet (`POST /v1/wallets`), or use the
     dashboard.
   - Fund that wallet's address at [faucet.circle.com](https://faucet.circle.com/)
     (browser only, no API - paste the address, request testnet USDC).
   - Call `GET /v1/wallets/:id/balance` through the running API. Once
     funded, Circle's own `getWalletBalances` response includes the
     token's real id - use `GET https://api.circle.com/v1/wallets/<walletId>/balances`
     directly with your API key if you want to see the raw response
     including the id, since the balance endpoint currently only returns
     `{assetCode, available}`.
   - Put that value in `CIRCLE_USDC_TOKEN_ID` and restart the API.

7. Restart `apps/api` so the new `.env` values are picked up (`CircleWalletRail`
   is built once, at server startup, from `circle-rail.provider.ts`).

## Rotating the entity secret

Do this if the secret may have leaked, or on whatever schedule your
security posture calls for. Circle requires calling their rotate endpoint
with the *current* secret before a new one takes effect - simply generating
a new one and overwriting `.env` would desync Paymod from what Circle
actually expects, so `circle-register-entity-secret.ts` deliberately refuses
to run while `CIRCLE_ENTITY_SECRET` is already set.

1. Remove the current `CIRCLE_ENTITY_SECRET` line from `apps/api/.env`
   (keep a copy of the old value somewhere until rotation is confirmed
   working, in case you need to roll back).
2. Re-run `npx tsx apps/api/scripts/circle-register-entity-secret.ts` - this
   registers a brand new secret and writes a new recovery file.
3. Restart `apps/api`.
4. Securely delete the old secret's recovery file once you've confirmed the
   new one works (a real transfer or wallet creation succeeds).

`CIRCLE_WALLET_SET_ID` and `CIRCLE_USDC_TOKEN_ID` are unaffected by entity
secret rotation - they stay the same. (They are not unaffected by changing
`CIRCLE_BLOCKCHAIN`, which is a separate, unrelated change - see the table
above. Rotation and switching chains are two different operations.)

## Security notes

- `.env`, `circle-entity-public-key.pem` and `circle-recovery/` are all
  gitignored. Never commit any of them.
- The entity secret is the single credential that lets Circle execute on
  every Paymod-managed wallet. Treat it like a database root password, not
  like an API key you'd casually paste around.
- If a real (non-test) `CIRCLE_API_KEY` or `CIRCLE_ENTITY_SECRET` ever ends
  up somewhere it shouldn't (a chat log, a screen share, a support ticket),
  rotate it - the API key from Circle Console, the entity secret via the
  rotation steps above.
