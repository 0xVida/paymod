import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

/** already-installed VS Code builds, preferred over a ~300MB download. */
const LOCAL_VSCODE_BINARIES = [
  "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
  "/usr/share/code/code",
  "/opt/visual-studio-code/code",
];

/**
 * Launches a real VS Code with this extension loaded from source and runs
 * `dist/test/suite.js` inside its extension host. `--disable-extensions`
 * only disables *other* extensions; the one under
 * `extensionDevelopmentPath` still loads, which is the whole point.
 *
 * Prefers an installed VS Code: the download path pulls ~300MB and is by
 * far the slowest part of this. Set `PAYMOD_E2E_DOWNLOAD_VSCODE=1` to force
 * a clean pinned build instead, which is what CI should do.
 *
 * Run through `npm run test:e2e` from `apps/code-extension`, which is what
 * makes the working directory the extension root.
 */
async function main(): Promise<void> {
  // anything launched from a VS Code integrated terminal inherits
  // ELECTRON_RUN_AS_NODE=1. Passing that down to the VS Code we spawn makes
  // it run as plain Node and try to `require` the first launch arg instead
  // of opening it as a workspace, so it has to be dropped here.
  delete process.env["ELECTRON_RUN_AS_NODE"];

  const extensionDevelopmentPath = resolve(process.cwd());
  const extensionTestsPath = resolve(extensionDevelopmentPath, "dist/test/suite.js");
  const workspace = await mkdtemp(join(tmpdir(), "paymod-code-e2e-"));

  const local = process.env["PAYMOD_E2E_DOWNLOAD_VSCODE"] ? undefined : LOCAL_VSCODE_BINARIES.find((path) => existsSync(path));
  if (local) console.log(`Using installed VS Code: ${local}`);

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    ...(local && { vscodeExecutablePath: local }),
    // only used on the download path; the default is a 15s idle timeout,
    // which a 300MB fetch doesn't fit inside.
    timeout: 10 * 60 * 1000,
    launchArgs: [workspace, "--disable-extensions", "--disable-gpu", "--no-sandbox"],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
