import React from "react";
import { render } from "ink";
import { mkdir } from "node:fs/promises";
import { App } from "./ui/App.js";
import { Root } from "./ui/Root.js";
import { buildProvider } from "./provider.js";
import { login, logout, getCredential } from "./auth/cli-auth.js";
import { createSession, latestSessionForProject, listSessionsForProject, resumeSession } from "./session-runner.js";
import { runNonInteractive } from "./non-interactive.js";
import { ARTIFACTS_DIR, COMPACTION_RECORDS_DIR, SESSIONS_DIR } from "./config.js";

function parseArgs(argv: string[]) {
  const args = { prompt: undefined as string | undefined, continueSession: false, resumeId: undefined as string | undefined, command: undefined as string | undefined };
  if (argv[0] === "login" || argv[0] === "logout") {
    args.command = argv[0];
    return args;
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--print") args.prompt = argv[++i];
    else if (arg === "--continue") args.continueSession = true;
    else if (arg === "--resume") args.resumeId = argv[++i];
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "login") {
    await login((message) => process.stdout.write(`${message}\n`));
    process.stdout.write("Signed in.\n");
    return;
  }
  if (args.command === "logout") {
    await logout();
    process.stdout.write("Signed out.\n");
    return;
  }

  const credential = await getCredential();
  if (!credential) {
    process.stderr.write("Not signed in. Run `paymod-code login` first.\n");
    process.exitCode = 1;
    return;
  }

  const workspaceRoot = process.cwd();
  await mkdir(SESSIONS_DIR, { recursive: true });
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await mkdir(COMPACTION_RECORDS_DIR, { recursive: true });

  const explicitTarget = Boolean(args.resumeId || args.continueSession);
  const targeted = args.resumeId
    ? await resumeSession(SESSIONS_DIR, args.resumeId)
    : args.continueSession
      ? await latestSessionForProject(SESSIONS_DIR, workspaceRoot)
      : undefined;
  if (explicitTarget && !targeted) {
    process.stderr.write("No matching session found - starting a new one instead.\n");
  }

  if (args.prompt) {
    const activeSession = targeted ?? (await createSession(SESSIONS_DIR, workspaceRoot));
    const provider = buildProvider(activeSession.modelId, credential);
    await runNonInteractive({
      prompt: args.prompt,
      workspaceRoot,
      sessionId: activeSession.id,
      sessionsDir: SESSIONS_DIR,
      artifactsDir: ARTIFACTS_DIR,
      compactionRecordsDir: COMPACTION_RECORDS_DIR,
      provider,
      model: activeSession.modelId,
      initialTitle: activeSession.title,
      initialSession: { transcript: activeSession.transcript, activeCompaction: activeSession.activeCompaction, originalTask: activeSession.originalTask },
      lastContextUsage: activeSession.contextUsage,
    });
    return;
  }

  // an explicit --resume/--continue (or its not-found fallback) skips the
  // picker and goes straight to the chat - the user already said which
  // session they want. only a bare `paymod-code` with no target shows it.
  if (explicitTarget) {
    const activeSession = targeted ?? (await createSession(SESSIONS_DIR, workspaceRoot));
    const provider = buildProvider(activeSession.modelId, credential);
    render(
      React.createElement(App, {
        workspaceRoot,
        sessionId: activeSession.id,
        sessionsDir: SESSIONS_DIR,
        artifactsDir: ARTIFACTS_DIR,
        compactionRecordsDir: COMPACTION_RECORDS_DIR,
        provider,
        model: activeSession.modelId,
        initialTitle: activeSession.title,
        initialSession: { transcript: activeSession.transcript, activeCompaction: activeSession.activeCompaction, originalTask: activeSession.originalTask },
        ...(activeSession.contextUsage !== undefined && { initialContextUsage: activeSession.contextUsage }),
      }),
    );
    return;
  }

  const initialSessions = await listSessionsForProject(SESSIONS_DIR, workspaceRoot);
  render(
    React.createElement(Root, {
      workspaceRoot,
      sessionsDir: SESSIONS_DIR,
      artifactsDir: ARTIFACTS_DIR,
      compactionRecordsDir: COMPACTION_RECORDS_DIR,
      credential,
      initialSessions,
    }),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
