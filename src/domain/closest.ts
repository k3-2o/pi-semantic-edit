// --- On no-match, return the nearest near-miss; the floor (not pass thresholds) is the only gate ---

import { similarity } from './similarity';
import type { ClosestCandidate } from './types';
import { normalizeNewlines } from './utils';

const ANCHOR_FLOOR = 0.3;

export function findClosestCandidate(
  original: string,
  oldContent: string,
  maxCandidates = 50,
): ClosestCandidate | null {
  const orig = normalizeNewlines(original);
  const old = normalizeNewlines(oldContent).trim();
  if (old.length === 0) return null;

  const oldLines = old.split('\n');
  const firstLine = oldLines[0].trim();
  if (firstLine.length === 0) return null;

  const origLines = orig.split('\n');

  const anchors: { start: number; sim: number }[] = [];
  for (let i = 0; i < origLines.length && anchors.length < maxCandidates; i++) {
    const lineSim = similarity(origLines[i].trim(), firstLine);
    if (lineSim >= ANCHOR_FLOOR) anchors.push({ start: i, sim: lineSim });
  }

  if (anchors.length === 0) return null;

  let best: { start: number; end: number; sim: number } | null = null;
  for (const { start } of anchors) {
    const minEnd = start + oldLines.length - 1;
    const maxEnd = Math.min(start + oldLines.length * 2, origLines.length);
    for (let end = minEnd; end < maxEnd; end++) {
      const candidate = origLines
        .slice(start, end + 1)
        .join('\n')
        .trim();
      const sim = similarity(old, candidate);
      if (!best || sim > best.sim) best = { start, end, sim };
    }
  }

  if (!best) return null;

  const actual = origLines.slice(best.start, best.end + 1).join('\n');
  return {
    passName: 'closest-candidate',
    similarity: best.sim,
    candidate: actual,
    startLine: best.start + 1,
    endLine: best.end + 1,
  };
}
