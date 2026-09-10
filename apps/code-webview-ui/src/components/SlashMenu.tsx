export type SlashCommand = { name: string; description: string };

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Clear the composer" },
  { name: "plan", description: "Switch to Plan mode" },
  { name: "act", description: "Switch to Act mode" },
];

type Props = {
  commands: SlashCommand[];
  highlight: number;
  onSelect: (command: SlashCommand) => void;
};

/** only the commands that are actually wired to something real - Cline's slash menu has many more, but most depend on features (task compaction, MCP) this build doesn't have yet. */
export function SlashMenu({ commands, highlight, onSelect }: Props) {
  if (commands.length === 0) return <div className="context-menu-empty">No matching commands</div>;
  return (
    <div className="context-menu">
      <div className="context-menu-items">
        {commands.map((command, index) => (
          <div key={command.name} className={`mention-item slash-item${index === highlight ? " mention-item-active" : ""}`} onMouseDown={(event) => (event.preventDefault(), onSelect(command))}>
            <span className="slash-item-name">/{command.name}</span>
            <span className="slash-item-desc">{command.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
