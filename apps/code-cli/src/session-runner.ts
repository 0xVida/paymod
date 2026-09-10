import { randomUUID } from "node:crypto";
import { MODEL_REGISTRY, listSessionFiles, readSessionFile, writeSessionFile, type RunSessionTurnResult, type StoredSession } from "@paymod/code-core";

const DEFAULT_MODEL_ID = MODEL_REGISTRY[0]!.id;

export async function createSession(sessionsDir: string, workspaceRoot: string, modelId: string = DEFAULT_MODEL_ID): Promise<StoredSession> {
  const session: StoredSession = {
    id: randomUUID(),
    title: "New session",
    project: workspaceRoot,
    modelId,
    lastActivity: new Date().toISOString(),
    transcript: [],
  };
  await writeSessionFile(sessionsDir, session);
  return session;
}

export function resumeSession(sessionsDir: string, id: string): Promise<StoredSession | undefined> {
  return readSessionFile(sessionsDir, id);
}

/** scoped to this project the same way `SessionRegistry.initialize()` scopes the extension's sidebar - `sessionsDir` has no other project boundary of its own, everything under it is one flat pool keyed only by `session.project`. `listSessionFiles` already sorts newest-first. */
export async function listSessionsForProject(sessionsDir: string, workspaceRoot: string): Promise<StoredSession[]> {
  const all = await listSessionFiles(sessionsDir);
  return all.filter((session) => session.project === workspaceRoot);
}

/** newest session for this project - `--continue` without an explicit id. */
export async function latestSessionForProject(sessionsDir: string, workspaceRoot: string): Promise<StoredSession | undefined> {
  const sessions = await listSessionsForProject(sessionsDir, workspaceRoot);
  return sessions[0];
}

export async function renameSession(sessionsDir: string, sessionId: string, title: string): Promise<void> {
  const existing = await readSessionFile(sessionsDir, sessionId);
  if (!existing) return;
  await writeSessionFile(sessionsDir, { ...existing, title });
}

/** preserves every field a turn doesn't know about (favorites, auto-approved tools, etc.) - only `transcript`/`activeCompaction`/`originalTask`/`contextUsage`/`lastActivity` change on a turn. */
export async function persistTurn(sessionsDir: string, sessionId: string, modelId: string, turn: RunSessionTurnResult): Promise<void> {
  const existing = await readSessionFile(sessionsDir, sessionId);
  const session: StoredSession = {
    id: sessionId,
    title: existing?.title ?? "New session",
    project: existing?.project ?? "",
    modelId,
    lastActivity: new Date().toISOString(),
    ...(existing?.mode !== undefined && { mode: existing.mode }),
    ...(existing?.disabledRuleFiles !== undefined && { disabledRuleFiles: existing.disabledRuleFiles }),
    ...(existing?.autoApprovedTools !== undefined && { autoApprovedTools: existing.autoApprovedTools }),
    ...(existing?.usage !== undefined && { usage: existing.usage }),
    ...(turn.contextUsage !== undefined ? { contextUsage: turn.contextUsage } : existing?.contextUsage !== undefined && { contextUsage: existing.contextUsage }),
    ...(existing?.favorite !== undefined && { favorite: existing.favorite }),
    transcript: turn.transcript,
    activeCompaction: turn.activeCompaction,
    originalTask: turn.originalTask,
  };
  await writeSessionFile(sessionsDir, session);
}
