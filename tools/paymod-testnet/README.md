# Paymod Testnet CLI

Terminal-only Treasury verification. It uses isolated disposable Testnet
identities and never requires the frontend.

```sh
npm --prefix tools/paymod-testnet run cli -- doctor
npm --prefix tools/paymod-testnet run cli -- init
npm --prefix tools/paymod-testnet run cli -- show
```

The CLI state is Git-ignored and contains Testnet key material only.
