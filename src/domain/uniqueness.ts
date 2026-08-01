// Uniqueness verification — the "never guess" guard.
// OpenDev semantics: count occurrences of the ACTUAL matched text (not the
// query); more than one occurrence means the edit is ambiguous and must fail
// with line positions instead of silently picking a location.

import { findOccurrencePositions } from './chain';

export interface OccurrenceReport {
  count: number;
  /** 1-indexed line numbers of each occurrence. */
  positions: number[];
  ambiguous: boolean;
}

/** Count occurrences of `actual` in `content` and report their line positions. */
export function reportOccurrences(content: string, actual: string): OccurrenceReport {
  const positions = findOccurrencePositions(content, actual);
  const count = positions.length;
  return { count, positions, ambiguous: count > 1 };
}

/** Line numbers formatted for error messages, e.g. "line 3, line 7, line 12". */
export function formatLinePositions(positions: number[]): string {
  return positions.map((n) => `line ${n}`).join(', ');
}
