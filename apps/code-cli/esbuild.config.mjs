import { build } from "esbuild";
import { copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const production = process.argv.includes("--production");
const require = createRequire(import.meta.url);

// ink's reconciler.js only dynamically imports devtools.js when DEV=true
// and react-devtools-core actually resolves - both externals are needed
// together. Marking only the package name isn't enough: esbuild still
// inlines devtools.js's own body into the bundle, which hoists its
// top-level `import devtools from "react-devtools-core"` per ESM
// semantics regardless of the runtime DEV check that used to guard it as
// a genuinely separate, lazily-loaded module. esbuild's external glob
// only matches within one path segment (no `/`), so a wildcard pattern
// can't reach across node_modules/ink/build/ - resolving the exact
// absolute path instead sidesteps that entirely. Can't `require.resolve`
// the subpath (or even package.json) directly either: ink's "exports"
// map only whitelists its main entry point. Resolving that main entry
// (the one path guaranteed to work) and joining the rest by hand skips
// the restriction since it's plain path math, not a module resolution.
const inkBuildDir = dirname(require.resolve("ink"));
const devtoolsPath = join(inkBuildDir, "devtools.js");

const shared = {
  bundle: true,
  platform: "node",
  // ESM, not CJS: yoga-layout (ink's layout engine) uses real top-level
  // await in its own source to load its WASM binary - CJS output can't
  // represent that at all, esbuild refuses to even build it. ESM means
  // none of CJS's usual globals exist at runtime, though, so bundled CJS
  // dependencies that rely on them break: `require(...)` inside a
  // function body (ink's own transitive deps, e.g. signal-exit's
  // `require("assert")`) throws "Dynamic require of ... is not
  // supported" once esbuild's own CJS-interop shim finds no real
  // `require` to delegate to, and `__dirname`/`__filename` (tiktoken's
  // own bundled loader uses these to find its .wasm file on disk) are
  // simply undefined. The banner below reconstructs both from
  // `import.meta.url`, the one thing ESM always has.
  format: "esm",
  target: "node20",
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __createRequire } from "node:module";',
      'import { fileURLToPath as __fileURLToPath } from "node:url";',
      'import { dirname as __dirname_fn } from "node:path";',
      "const require = __createRequire(import.meta.url);",
      "const __filename = __fileURLToPath(import.meta.url);",
      "const __dirname = __dirname_fn(__filename);",
    ].join("\n"),
  },
  sourcemap: !production,
  minify: production,
  external: ["react-devtools-core", devtoolsPath],
  // React's dev-mode code path does `require("assert")` behind a
  // NODE_ENV check for its own invariant assertions - esbuild can't
  // prove that branch dead without knowing the value, so it ships a
  // runtime require shim that throws "Dynamic require of assert is not
  // supported" the moment the module loads. Defining it lets esbuild
  // eliminate the whole dev branch at build time instead.
  define: { "process.env.NODE_ENV": '"production"' },
};

// tiktoken loads its WASM binary from disk at runtime, relative to the
// bundled file's own directory - esbuild only bundles JS, so this copy is
// required or OpenAiProvider.estimateTokens throws "Missing
// tiktoken_bg.wasm" the moment the packaged CLI runs, same issue
// apps/code-extension's own esbuild config works around.
const tiktokenWasm = createRequire(import.meta.url).resolve("tiktoken/tiktoken_bg.wasm");

await build({ ...shared, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js" });
copyFileSync(tiktokenWasm, "dist/tiktoken_bg.wasm");
