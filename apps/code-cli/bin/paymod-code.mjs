#!/usr/bin/env node
// plain, pre-built launcher (never transpiled) - the actual `bin` target.
// imports resolve from this file's own location, not the caller's cwd, so
// `paymod-code` works from any project on disk, not just this monorepo.
import { tsImport } from "tsx/esm/api";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
await tsImport(pathToFileURL(join(packageRoot, "src", "cli.ts")).href, import.meta.url);
