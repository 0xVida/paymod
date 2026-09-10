import { AnthropicProvider, OpenAiProvider, getModelDescriptor, type ModelProvider } from "@paymod/code-core";
import { getApiUrl } from "./auth/cli-auth.js";

/**
 * no BYOK for the CLI's first pass (that's `ByokKeyStore`'s VS Code
 * `SecretStorage` integration on the extension side - the CLI would need
 * its own equivalent, deliberately deferred rather than scope-creeping
 * this first version). every call routes through Paymod's proxy.
 */
export function buildProvider(modelId: string, apiKey: string): ModelProvider {
  const descriptor = getModelDescriptor(modelId);
  if (!descriptor) throw new Error(`Unknown model: ${modelId}`);
  const baseUrl = `${getApiUrl()}/v1/code/inference/${descriptor.provider}`;
  return descriptor.provider === "openai" ? new OpenAiProvider({ baseUrl, apiKey }) : new AnthropicProvider({ baseUrl, apiKey });
}

export function systemPrompt(workspaceRoot: string): string {
  return (
    `You are Paymod Code, an AI coding agent working in a real repository at ${workspaceRoot}. ` +
    "Use the available tools to read files, search the codebase, propose edits and run commands or tests. " +
    "Edits are shown to the user as a diff for review before anything is written. Make real changes rather than only describing them."
  );
}
