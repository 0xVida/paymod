import * as vscode from "vscode";
import { PaymodCodeClient } from "@paymod/code-core";
import type { AuthState } from "./auth-state.js";

function getApiUrl(): string {
  return vscode.workspace.getConfiguration("paymodCode").get<string>("apiUrl", "http://localhost:3001");
}

/**
 * Cached read of the real balance (`GET /v1/code/wallet/balance`,
 * PAYMOD_CODE_PLAN.md section 2). No polling loop: `refresh()` only runs
 * from signals that already redraw the sidebar (`AuthState`/
 * `SessionRegistry` changes), matching the plan's "no watcher" posture.
 */
export class BalanceState {
  private balanceUsd: number | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly authState: AuthState) {}

  get(): number | undefined {
    return this.balanceUsd;
  }

  async refresh(): Promise<void> {
    if (!this.authState.isSignedIn()) {
      if (this.balanceUsd !== undefined) {
        this.balanceUsd = undefined;
        this.emitter.fire();
      }
      return;
    }
    const credential = await this.authState.getCredential();
    if (!credential) return;
    try {
      const client = new PaymodCodeClient(getApiUrl());
      const { balanceUsd } = await client.getBalance(credential);
      this.balanceUsd = balanceUsd;
      this.emitter.fire();
    } catch {
      // A transient network failure leaves the last known balance on
      // screen rather than replacing it with an error - the sidebar isn't
      // the place to surface that.
    }
  }
}
