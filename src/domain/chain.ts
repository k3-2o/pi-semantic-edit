// findMatch — executes the REPLACER_CHAIN in order, short-circuiting on first
// match (OpenDev parity: edit_replacers::find_match).

import { REPLACER_CHAIN } from './passes';
import type { MatchResult } from './types';
import { normalizeNewlines } from './utils';

/**
 * Run the 9-pass chain. Returns the actual substring in `original` that
 * matches `oldContent` (LF-normalized), or null if no pass succeeds.
 * Port of OpenDev's find_match(): line endings are normalized first.
 */
export function findMatch(original: string, oldContent: string): MatchResult | null {
  const orig = normalizeNewlines(original);
  const old = normalizeNewlines(oldContent);

  for (const { name, find } of REPLACER_CHAIN) {
    const actual = find(orig, old);
    if (actual !== null) {
      return { actual, passName: name };
    }
  }
  return null;
}

/**
 * Find 1-indexed line numbers of all occurrences of `needle` in `haystack`.
 * Port of OpenDev's find_occurrence_positions().
 */
export function findOccurrencePositions(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  let searchPos = 0;
  while (searchPos <= haystack.length) {
    const idx = haystack.indexOf(needle, searchPos);
    if (idx === -1) break;
    const lineNum = haystack.slice(0, idx).split('\n').length; // count of \n + 1
    positions.push(lineNum);
    searchPos = idx + 1;
  }
  return positions;
}
