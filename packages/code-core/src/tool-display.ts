/** the shell-like command line shown in a Bash-style IN/OUT card; `undefined` for tools that don't run a shell command (most tools). */
export function commandLineFor(toolName: string, args: Record<string, unknown>): string | undefined {
  const argList = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => String(item)) : []);
  if (toolName === "run_command" && typeof args["executable"] === "string") {
    return [args["executable"], ...argList(args["args"])].join(" ");
  }
  if (toolName === "run_tests") {
    if (typeof args["command"] === "string") return [args["command"], ...argList(args["args"])].join(" ");
    return "npm test";
  }
  return undefined;
}

/** the single file a tool call targets, when there is exactly one and unambiguous - the tool-activity feed's clickable-reference affordance only ever applies to a call like this. `apply_patch` can touch several files at once, so it isn't covered here; its files are opened from the diff card instead, one reference per file. */
export function filePathFor(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === "read_file" && typeof args["path"] === "string") return args["path"];
  return undefined;
}

/** A short, human-readable activity line for a tool call, matching the ADR's own mockup ("> Reading X" / "> Editing Y"). */
export function describeToolCall(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "read_file" && typeof args["path"] === "string") return `Reading ${args["path"]}`;
  if (toolName === "apply_patch") return "Editing files";
  if (toolName === "search_files") return "Searching the codebase";
  if (toolName === "list_directory") return "Listing files";
  if (toolName === "run_command" && typeof args["executable"] === "string") return `Running ${args["executable"]}`;
  if (toolName === "run_tests") return "Running tests";
  if (toolName.startsWith("git_")) return `Checking ${toolName.slice(4)}`;
  return toolName;
}
