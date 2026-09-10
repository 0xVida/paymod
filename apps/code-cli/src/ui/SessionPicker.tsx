import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { formatRelativeTime, type StoredSession } from "@paymod/code-core";

const NEW_SESSION = "new" as const;
type Choice = typeof NEW_SESSION | StoredSession;

/**
 * terminal equivalent of the extension's sidebar session list, so users
 * aren't stuck memorizing session ids for `--resume <id>`. sessions arrive
 * already scoped to this project (`cli.ts` only loads
 * `session.project === workspaceRoot` entries), the same boundary the
 * extension's `SessionRegistry` enforces.
 */
export function SessionPicker({ sessions, onSelect }: { sessions: StoredSession[]; onSelect: (choice: Choice) => void }) {
  const choices: Choice[] = [NEW_SESSION, ...sessions];
  const [index, setIndex] = useState(0);

  useInput((_char, key) => {
    if (key.upArrow) setIndex((current) => Math.max(0, current - 1));
    else if (key.downArrow) setIndex((current) => Math.min(choices.length - 1, current + 1));
    else if (key.return) onSelect(choices[index]!);
  });

  return (
    <Box flexDirection="column">
      <Text bold>Paymod Code</Text>
      <Text color="gray">{sessions.length > 0 ? "Select a session, or start a new one:" : "No sessions yet for this project."}</Text>
      <Box flexDirection="column" marginTop={1}>
        {choices.map((choice, choiceIndex) => {
          const selected = choiceIndex === index;
          const label = choice === NEW_SESSION ? "New session" : `${choice.title}  ${formatRelativeTime(choice.lastActivity)}`;
          return (
            <Text key={choice === NEW_SESSION ? NEW_SESSION : choice.id} {...(selected && { color: "cyan" })}>
              {selected ? "> " : "  "}
              {label}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">↑/↓ to move, Enter to select</Text>
      </Box>
    </Box>
  );
}
