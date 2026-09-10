import type { ToolActivityItem } from "../useAgentSession";
import { ToolOutputBlock } from "./ToolOutputBlock";
import { postToExtension } from "../vscode-api";

/** real VS Code codicon names (the same icon set Cline and VS Code itself use), grouped by what the tool actually does rather than one flat dot for everything. */
function iconFor(toolName: string): string {
  if (toolName === "read_file") return "codicon-file";
  if (toolName === "list_directory") return "codicon-folder-opened";
  if (toolName === "search_files") return "codicon-search";
  if (toolName === "apply_patch") return "codicon-edit";
  if (toolName === "run_command" || toolName === "run_tests") return "codicon-terminal";
  if (toolName.startsWith("git_")) return "codicon-git-commit";
  if (toolName === "compaction") return "codicon-archive";
  return "codicon-circle-small-filled";
}

const READ_OR_EDIT_TOOLS = new Set(["read_file", "apply_patch"]);

export function ToolActivity({ item }: { item: ToolActivityItem }) {
  const isReadOrEdit = READ_OR_EDIT_TOOLS.has(item.toolName);
  return (
    <>
      <div className={`entry-tool${isReadOrEdit ? " step-marker-active" : ""}`}>
        <span className={`codicon ${iconFor(item.toolName)} tool-icon`} />
        {item.filePath ? (
          <button type="button" className="tool-file-link" onClick={() => postToExtension({ type: "openFile", path: item.filePath! })}>
            {item.text}
          </button>
        ) : (
          item.text
        )}
      </div>
      {item.command && (
        <div className="tool-io">
          <div className="tool-io-label">IN</div>
          <div className="tool-io-line tool-io-in">{item.command}</div>
          {item.output && (
            <>
              <div className="tool-io-label">OUT</div>
              <ToolOutputBlock text={item.output} />
            </>
          )}
        </div>
      )}
    </>
  );
}
