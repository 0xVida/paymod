#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, "../..");
const stateDir = resolve(arg("--state-dir") ?? join(here, ".state"));
const config = join(stateDir, "stellar");
const stateFile = join(stateDir, "state.json");
const stellar = process.env.STELLAR_BIN ?? "stellar";
const rpcUrl = "https://soroban-testnet.stellar.org";
const network = "testnet";
const passphrase = "Test SDF Network ; September 2015";
const treasuryDir = resolve(root, "contracts/treasury");
const wasmPath = join(treasuryDir, "target/wasm32v1-none/release/paymod_treasury.wasm");

function arg(name) { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; }
function call(command, args, silent = false) {
  const r = spawnSync(command, args, { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status) throw new Error(r.stderr || r.stdout || `${command} failed`);
  if (!silent) process.stdout.write(r.stdout);
  return r.stdout.trim();
}
function stellarCall(args, silent = false) { return call(stellar, ["--config-dir", config, ...args], silent); }
async function save(state) { await mkdir(stateDir, { recursive: true, mode: 0o700 }); await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 }); await chmod(stateFile, 0o600); }
async function load() { if (!existsSync(stateFile)) throw new Error("No state found; run init first"); return JSON.parse(await readFile(stateFile, "utf8")); }

async function doctor() {
  let failed = false;
  for (const [label, command, args] of [["Stellar CLI", stellar, ["--version"]], ["Rust", "rustc", ["--version"]], ["WASM target", "rustup", ["target", "list", "--installed"]]]) {
    try { const out = call(command, args, true); const ok = label !== "WASM target" || out.includes("wasm32v1-none"); console.log(`${ok ? "✓" : "✗"} ${label}`); failed ||= !ok; } catch { console.log(`✗ ${label}`); failed = true; }
  }
  try { const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) }); console.log(`${r.ok ? "✓" : "✗"} Testnet RPC`); failed ||= !r.ok; } catch { console.log("✗ Testnet RPC"); failed = true; }
  if (failed) process.exitCode = 1;
}
async function init() {
  if (existsSync(stateFile)) throw new Error(`State already exists: ${stateFile}`);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  stellarCall(["network", "add", network, "--rpc-url", rpcUrl, "--network-passphrase", passphrase], true);
  for (const name of ["owner", "executor", "relayer"]) stellarCall(["keys", "generate", name, "--fund", "--network", network], true);
  const identities = Object.fromEntries(["owner", "executor", "relayer"].map((name) => [name, stellarCall(["keys", "public-key", name], true)]));
  await save({ network, rpcUrl, usdcContractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", identities, createdAt: new Date().toISOString() });
  await show();
}
async function show() { const state = await load(); console.log(JSON.stringify(state, null, 2)); console.log(`\nClaim Stellar Testnet USDC to owner: ${state.identities.owner}`); }

/**
 * per ADR 0007, the on-chain contract enforces a blast-radius backstop, not
 * the customer's real policy - the period is a tumbling window anchored to
 * payment time, not a calendar day. provision max-period at >= 2x (3x
 * recommended) the intended DAILY_LIMIT since MONTHLY_LIMIT is enforced
 * off-chain only.
 */
async function deploy() {
  const state = await load();
  if (state.treasury?.contractId) {
    throw new Error(`Treasury already deployed: ${state.treasury.contractId}. Deploy a new one with a different --state-dir or reuse the existing treasury.`);
  }

  const maxPerPayment = arg("--max-payment") ?? "2000000";
  const maxPerPeriod = arg("--max-period") ?? "20000000";
  const periodSeconds = arg("--period-seconds") ?? "86400";

  console.log("Building the treasury contract (cargo build --target wasm32v1-none --release)...");
  const build = spawnSync("bash", [join(treasuryDir, "scripts/build-wasm.sh")], { encoding: "utf8" });
  if (build.status) throw new Error(build.stderr || "WASM build failed");
  if (!existsSync(wasmPath)) throw new Error(`Expected WASM artifact not found at ${wasmPath}`);

  console.log("Deploying...");
  const contractId = stellarCall(["contract", "deploy", "--wasm", wasmPath, "--source-account", "owner", "--network", network], true);

  console.log("Initializing...");
  const executorPublicKey = StrKey.decodeEd25519PublicKey(state.identities.executor).toString("hex");
  stellarCall([
    "contract", "invoke", "--id", contractId, "--source-account", "owner", "--network", network, "--",
    "initialize",
    "--owner", state.identities.owner,
    "--executor", state.identities.executor,
    "--executor_public_key", executorPublicKey,
    "--token", state.usdcContractId,
    "--max_per_payment", maxPerPayment,
    "--max_per_period", maxPerPeriod,
    "--period_seconds", periodSeconds,
    "--authority_expires_at", "0",
  ], true);

  state.treasury = {
    contractId,
    maxPerPaymentAtomic: maxPerPayment,
    maxPerPeriodAtomic: maxPerPeriod,
    periodSeconds: Number(periodSeconds),
    deployedAt: new Date().toISOString(),
  };
  await save(state);

  console.log(`\nDeployed and initialized Treasury Contract: ${contractId}`);
  console.log("\nmax-per-payment, max-per-period and period-seconds can be raised later by the");
  console.log("owner via set_limits, but are not exposed through any product surface yet.");
  console.log("See docs/adr/0007-onchain-backstop-vs-offchain-policy.md before funding real limits.");
  console.log(`\nFund it next: paymod-testnet fund --amount <atomic-usdc>`);
}

/** transfers USDC from the owner identity into the deployed treasury */
async function fund() {
  const state = await load();
  if (!state.treasury?.contractId) throw new Error("No treasury deployed; run `paymod-testnet deploy` first");
  const amount = arg("--amount");
  if (!amount) throw new Error("--amount (atomic USDC, 7 decimals) is required");

  stellarCall([
    "contract", "invoke", "--id", state.usdcContractId, "--source-account", "owner", "--network", network, "--",
    "transfer",
    "--from", state.identities.owner,
    "--to", state.treasury.contractId,
    "--amount", amount,
  ], true);

  console.log(`Funded treasury ${state.treasury.contractId} with ${amount} atomic USDC.`);
}

/**
 * CLI-side half of the same verification `POST /v1/wallets/:id/activate`
 * performs when a wallet is activated through the dashboard instead. still
 * models one treasury per identity set, not the wallet-per-agent model
 * (ADR 0010) - fine for local testnet setup.
 */
async function register() {
  const state = await load();
  if (!state.treasury?.contractId) throw new Error("No treasury deployed; run `paymod-testnet deploy` first");

  const executor = stellarCall(["contract", "invoke", "--id", state.treasury.contractId, "--source-account", "owner", "--network", network, "--", "executor"], true).replace(/^"|"$/g, "");
  const paused = stellarCall(["contract", "invoke", "--id", state.treasury.contractId, "--source-account", "owner", "--network", network, "--", "is_paused"], true).trim();

  if (executor !== state.identities.executor) {
    throw new Error(`Treasury executor is ${executor}, not the expected Paymod executor ${state.identities.executor}. Refusing to register.`);
  }
  if (paused !== "false") {
    throw new Error("Treasury is paused. Refusing to register.");
  }

  console.log(`Treasury ${state.treasury.contractId} verified: executor matches, not paused.`);
  console.log("Registration with a running API is not available yet (apps/api ships in Slice 1 Day 3-4).");
  console.log("This treasury is ready to be used directly against @paymod/stellar in the meantime.");
}

function help() { console.log("Usage: paymod-testnet <doctor|init|show|deploy|fund|register> [--state-dir path]"); }
try {
  const cmd = process.argv[2];
  if (cmd === "doctor") await doctor();
  else if (cmd === "init") await init();
  else if (cmd === "show") await show();
  else if (cmd === "deploy") await deploy();
  else if (cmd === "fund") await fund();
  else if (cmd === "register") await register();
  else help();
} catch (e) { console.error(`Error: ${e.message}`); process.exitCode = 1; }
