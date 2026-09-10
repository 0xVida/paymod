import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const production = process.argv.includes("--production");
const withTests = process.argv.includes("--tests");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
};

// tiktoken loads its WASM binary from disk at runtime, relative to the
// bundled file's own directory - esbuild only bundles JS, so this copy is
// required or `OpenAiProvider.estimateTokens` throws "Missing
// tiktoken_bg.wasm" the moment the packaged extension activates.
const tiktokenWasm = createRequire(import.meta.url).resolve("tiktoken/tiktoken_bg.wasm");

await build({ ...shared, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js" });
copyFileSync(tiktokenWasm, "dist/tiktoken_bg.wasm");

// the E2E suite runs inside the extension host, so it needs the same CJS +
// `vscode`-external treatment as the extension itself. Never minified: a
// failing assertion should point at readable source.
if (withTests) {
  await build({ ...shared, minify: false, entryPoints: ["src/test/suite.ts"], outfile: "dist/test/suite.js" });
  mkdirSync("dist/test", { recursive: true });
  copyFileSync(tiktokenWasm, "dist/test/tiktoken_bg.wasm");
}
