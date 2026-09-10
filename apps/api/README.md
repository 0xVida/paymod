# @paymod/api

NestJS control-plane API for Paymod Wallet / Payments and Paymod Code. It
provides wallet, policy, intent, settlement, x402, audit and session endpoints,
plus Paymod Code device authorization and managed inference proxy endpoints.

## Running

```sh
docker compose up -d          # postgres:16 + redis:7, from the repo root
cp .env.example .env          # fill in the Stellar and bootstrap secrets
npm run start                 # from apps/api or `npm run dev:web`-style from root
curl localhost:3001/health
```

## Why this always runs through a build, never `tsx src/main.ts` directly

NestJS's dependency injection reads constructor parameter types from
TypeScript's `emitDecoratorMetadata` output. `tsx` (and Vite and Bun)
transpile through esbuild, which does not implement that compiler option.
Every constructor-injected provider silently resolves to `undefined` at
runtime and Nest fails with `UndefinedDependencyException` pointing at an
argument index rather than a name.

`npm run dev`/`start` therefore always compile with real `tsc`
(`tsconfig.build.json`) first, which bakes the correct metadata into the
emitted JS, then execute that compiled output through `tsx`. `tsx` is still
needed at that point only to resolve the sibling `@paymod/*` workspace
packages, which remain TypeScript-source-only (`exports: "./src/index.ts"`)
with no build step of their own.
