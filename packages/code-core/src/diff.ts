export type DiffLineKind = "context" | "add" | "remove";
export type DiffLine = { kind: DiffLineKind; text: string };

// a full LCS table is O(lines^2) in time and space - past this size a real
// diff isn't worth the cost, so the file is shown as a full replace instead
const MAX_DIFF_CELLS = 200_000;

/** a real line diff (LCS-based), not a naive "show both sides" dump - most of a rewritten file is usually unchanged, and this is what makes a diff view show only what actually changed. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const n = oldLines.length;
  const m = newLines.length;

  if (n * m > MAX_DIFF_CELLS) {
    return [...oldLines.map((text): DiffLine => ({ kind: "remove", text })), ...newLines.map((text): DiffLine => ({ kind: "add", text }))];
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = oldLines[i] === newLines[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: "context", text: oldLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      result.push({ kind: "remove", text: oldLines[i]! });
      i++;
    } else {
      result.push({ kind: "add", text: newLines[j]! });
      j++;
    }
  }
  while (i < n) result.push({ kind: "remove", text: oldLines[i++]! });
  while (j < m) result.push({ kind: "add", text: newLines[j++]! });
  return result;
}

/** the 1-indexed span of lines in the new file that the edit actually touched, from the first added line to the last - the outer bound across every hunk, not one range per hunk, so a click can jump to and highlight roughly where an edit landed without a multi-range selection. `undefined` for a pure deletion (nothing was added to the new file). */
export function changedLineRange(oldText: string, newText: string): { start: number; end: number } | undefined {
  let newLine = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const line of diffLines(oldText, newText)) {
    if (line.kind === "remove") continue;
    newLine += 1;
    if (line.kind === "add") {
      start ??= newLine;
      end = newLine;
    }
  }
  return start !== undefined && end !== undefined ? { start, end } : undefined;
}

/** drops unchanged context entirely and marks a skipped run between two change groups with a single "⋮" line, so an edit touching two distant parts of a large file doesn't read as one continuous block. */
export function compactDiffLines(lines: DiffLine[]): DiffLine[] {
  const result: DiffLine[] = [];
  let sawContextSinceLastChange = false;
  for (const line of lines) {
    if (line.kind === "context") {
      sawContextSinceLastChange = true;
      continue;
    }
    if (sawContextSinceLastChange && result.length > 0) result.push({ kind: "context", text: "⋮" });
    sawContextSinceLastChange = false;
    result.push(line);
  }
  return result;
}
