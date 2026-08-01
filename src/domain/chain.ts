import { REPLACER_CHAIN } from './passes';
import type { MatchResult } from './types';
import { normalizeNewlines } from './utils';

/**
 * Run the replacer chain in order, short-circuiting on the first match.
 * Line endings are normalized first (port of OpenDev's find_match()).
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

/** 1-indexed line numbers of every occurrence of `needle` in `haystack`. */
export function findOccurrencePositions(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  let searchPos = 0;
  while (searchPos <= haystack.length) {
    const idx = haystack.indexOf(needle, searchPos);
    if (idx === -1) break;
    positions.push(haystack.slice(0, idx).split('\n').length); // newlines + 1
    searchPos = idx + 1;
  }
  return positions;
}
