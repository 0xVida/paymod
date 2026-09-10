import React from "react";
import { Box, Text, useInput } from "ink";

/**
 * built on Ink's own `useInput` instead of `ink-text-input`, which pins
 * `ink@5` in its own dependencies and drags back the react-reconciler
 * version this package was upgraded to Ink 7 to get away from (Ink 5's
 * reconciler doesn't support React 19). Backspace and printable characters
 * only - no cursor movement, no paste handling.
 */
export function Composer({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit: (value: string) => void }) {
  useInput((char, key) => {
    if (key.return) {
      onSubmit(value);
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else if (!key.ctrl && !key.meta && char) {
      onChange(value + char);
    }
  });

  return (
    <Box>
      <Text color="cyan">{"> "}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
