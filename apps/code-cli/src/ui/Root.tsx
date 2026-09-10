import React, { useState } from "react";
import type { StoredSession } from "@paymod/code-core";
import { SessionPicker } from "./SessionPicker.js";
import { App } from "./App.js";
import { buildProvider } from "../provider.js";
import { createSession } from "../session-runner.js";

/**
 * `paymod-code` with no `--resume`/`--continue`/`-p` shows this picker
 * first - the terminal equivalent of the extension's sidebar session
 * list, so a prior session is a couple of keystrokes away instead of
 * requiring a memorized/looked-up id passed to `--resume`.
 */
export function Root({
  workspaceRoot,
  sessionsDir,
  artifactsDir,
  compactionRecordsDir,
  credential,
  initialSessions,
}: {
  workspaceRoot: string;
  sessionsDir: string;
  artifactsDir: string;
  compactionRecordsDir: string;
  credential: string;
  initialSessions: StoredSession[];
}) {
  const [session, setSession] = useState<StoredSession | undefined>(undefined);

  if (!session) {
    return (
      <SessionPicker
        sessions={initialSessions}
        onSelect={(choice) => {
          if (choice === "new") void createSession(sessionsDir, workspaceRoot).then(setSession);
          else setSession(choice);
        }}
      />
    );
  }

  const provider = buildProvider(session.modelId, credential);
  return (
    <App
      workspaceRoot={workspaceRoot}
      sessionId={session.id}
      sessionsDir={sessionsDir}
      artifactsDir={artifactsDir}
      compactionRecordsDir={compactionRecordsDir}
      provider={provider}
      model={session.modelId}
      initialTitle={session.title}
      initialSession={{ transcript: session.transcript, activeCompaction: session.activeCompaction, originalTask: session.originalTask }}
      {...(session.contextUsage !== undefined && { initialContextUsage: session.contextUsage })}
    />
  );
}
