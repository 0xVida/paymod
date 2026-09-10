import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  deleteSessionArtifacts,
  deleteSessionCompactionRecords,
  deleteSessionFile,
  listSessionFiles,
  MODEL_REGISTRY,
  writeSessionFile,
  type StoredSession,
} from "@paymod/code-core";
import { DEFAULT_SESSION_TITLE } from "../sidebar/types.js";

const DEFAULT_MODEL_ID = MODEL_REGISTRY[0]!.id;

/**
 * Disk-backed session list (`@paymod/code-core`'s `session-store.ts`, one
 * JSON file per session under global storage). Holds full message history
 * per session; `session-list.ts` only needs the lighter fields.
 */
export class SessionRegistry {
  private sessions: StoredSession[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly dir: string,
    private readonly artifactsDir: string,
    private readonly compactionRecordsDir: string,
  ) {}

  /**
   * `this.dir` is VS Code's global storage, shared across every project
   * this extension has ever run in. Filtering by `Session.project` here,
   * once, means every consumer of `list()`/`get()` only sees this
   * project's sessions.
   */
  async initialize(): Promise<void> {
    const all = await listSessionFiles(this.dir);
    const project = workspaceProjectName();
    this.sessions = all.filter((session) => session.project === project);
  }

  list(): readonly StoredSession[] {
    return this.sessions;
  }

  get(id: string): StoredSession | undefined {
    return this.sessions.find((session) => session.id === id);
  }

  async create(title = DEFAULT_SESSION_TITLE): Promise<StoredSession> {
    const session: StoredSession = {
      id: randomUUID(),
      title,
      project: workspaceProjectName(),
      modelId: DEFAULT_MODEL_ID,
      lastActivity: new Date().toISOString(),
      mode: "act",
      disabledRuleFiles: [],
      autoApprovedTools: [],
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      favorite: false,
      transcript: [],
    };
    this.sessions = [session, ...this.sessions];
    await writeSessionFile(this.dir, session);
    this.emitter.fire();
    return session;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.patch(id, { title });
  }

  async remove(id: string): Promise<void> {
    this.sessions = this.sessions.filter((session) => session.id !== id);
    await deleteSessionFile(this.dir, id);
    await deleteSessionArtifacts(this.artifactsDir, id);
    await deleteSessionCompactionRecords(this.compactionRecordsDir, id);
    this.emitter.fire();
  }

  /** one event/write pass for a multi-select delete instead of N - the sidebar's own bulk-delete action. */
  async removeMany(ids: readonly string[]): Promise<void> {
    const idSet = new Set(ids);
    this.sessions = this.sessions.filter((session) => !idSet.has(session.id));
    await Promise.all(ids.map((id) => deleteSessionFile(this.dir, id)));
    await Promise.all(ids.map((id) => deleteSessionArtifacts(this.artifactsDir, id)));
    await Promise.all(ids.map((id) => deleteSessionCompactionRecords(this.compactionRecordsDir, id)));
    this.emitter.fire();
  }

  /**
   * Freshens `lastActivity` without disturbing untouched fields.
   * `touchLastActivity: false` is for patches that aren't real activity
   * (starring a session) - bumping it there would wrongly reorder a
   * "sort by newest" list from a toggle.
   */
  async patch(
    id: string,
    fields: Partial<Pick<StoredSession, "title" | "modelId" | "transcript" | "activeCompaction" | "originalTask" | "mode" | "disabledRuleFiles" | "autoApprovedTools" | "usage" | "contextUsage" | "favorite">>,
    options?: { touchLastActivity?: boolean },
  ): Promise<StoredSession | undefined> {
    const session = this.get(id);
    if (!session) return undefined;

    const touchLastActivity = options?.touchLastActivity ?? true;
    const updated: StoredSession = { ...session, ...fields, ...(touchLastActivity && { lastActivity: new Date().toISOString() }) };
    this.sessions = this.sessions.map((existing) => (existing.id === id ? updated : existing)).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    await writeSessionFile(this.dir, updated);
    this.emitter.fire();
    return updated;
  }
}

function workspaceProjectName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name ?? "";
}

/**
 * Which session is currently loaded into the Secondary Side Bar's
 * `ChatSidebarViewProvider`. Separate from `SessionRegistry` (the list)
 * and `ChatPanel`'s editor tabs, since only one session can be docked
 * here at a time.
 */
export class SecondarySidebarState {
  private current: StoredSession | undefined;
  private readonly emitter = new vscode.EventEmitter<StoredSession | undefined>();
  readonly onDidChange = this.emitter.event;

  get(): StoredSession | undefined {
    return this.current;
  }

  set(session: StoredSession): void {
    this.current = session;
    this.emitter.fire(session);
  }
}
