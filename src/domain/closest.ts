import { similarity } from './similarity';
import type { ClosestCandidate } from './types';
import { normalizeNewlines } from './utils';

const STRONG_ANCHOR_FLOOR = 0.3;
const MID_ANCHOR_FLOOR = 0.55;
const WEAK_ANCHOR_FLOOR = 0.25;
export const MIN_CLOSEST_SIM = 0.15;
export const MAX_DIFF_HINTS = 2;

export function findClosestCandidate(
  original: string,
  oldContent: string,
  maxCandidates = 50,
): ClosestCandidate | null {
  const orig = normalizeNewlines(original);
  const old = normalizeNewlines(oldContent).trim();
  if (old.length === 0) return null;

  const oldLines = old.split('\n');
  const origLines = orig.split('\n');

  const simCache = new Map<string, number>();
  const lineSim = (fi: number, oi: number): number => {
    const key = `${fi}:${oi}`;
    let s = simCache.get(key);
    if (s === undefined) {
      s = similarity(origLines[oi].trim(), oldLines[fi].trim());
      simCache.set(key, s);
    }
    return s;
  };

  const firstLine = oldLines[0].trim();
  if (firstLine.length === 0) return null;

  const strongAnchors: number[] = [];
  const weakAnchors: number[] = [];
  for (let i = 0; i < origLines.length && strongAnchors.length < maxCandidates; i++) {
    const firstSim = lineSim(0, i);
    if (firstSim >= STRONG_ANCHOR_FLOOR || lineSim(oldLines.length - 1, i) >= STRONG_ANCHOR_FLOOR) {
      strongAnchors.push(i);
      continue;
    }
    let midBest = 0;
    for (let k = 1; k < oldLines.length - 1 && midBest < MID_ANCHOR_FLOOR; k++) {
      midBest = Math.max(midBest, lineSim(k, i));
    }
    if (midBest >= MID_ANCHOR_FLOOR) {
      strongAnchors.push(i);
      continue;
    }
    if (
      weakAnchors.length < maxCandidates &&
      (firstSim >= WEAK_ANCHOR_FLOOR || lineSim(oldLines.length - 1, i) >= WEAK_ANCHOR_FLOOR)
    ) {
      weakAnchors.push(i);
    }
  }

  const anchors = strongAnchors.length > 0 ? strongAnchors : weakAnchors;
  if (anchors.length === 0) return null;

  const maxHeight = oldLines.length * 2;
  const alignMemo = new Map<string, number>();
  const windowAlignScore = (start: number, height: number): number => {
    const key = `${start}:${height}`;
    const hit = alignMemo.get(key);
    if (hit !== undefined) return hit;
    const m = oldLines.length;
    let prev = new Array<number>(height + 1).fill(0);
    let curr = new Array<number>(height + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= height; j++) {
        const match = prev[j - 1] + lineSim(i - 1, start + j - 1);
        curr[j] = Math.max(prev[j], curr[j - 1], match);
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }
    const score = prev[height] / m;
    alignMemo.set(key, score);
    return score;
  };

  const charSimOf = (start: number, end: number): number => {
    const win = origLines
      .slice(start, end + 1)
      .join('\n')
      .trim();
    return similarity(old, win);
  };

  let best: { start: number; end: number; score: number } | null = null;
  for (const start of anchors) {
    for (let end = start; end < origLines.length; end++) {
      const height = end - start + 1;
      if (height > maxHeight) break;
      const aligned = windowAlignScore(start, height);
      const charSim = charSimOf(start, end);
      const score = 0.65 * aligned + 0.35 * charSim;
      if (!best || score > best.score) best = { start, end, score };
    }
  }

  if (!best || best.score < MIN_CLOSEST_SIM) return null;

  const actual = origLines.slice(best.start, best.end + 1).join('\n');
  return {
    passName: 'closest-candidate',
    similarity: best.score,
    candidate: actual,
    startLine: best.start + 1,
    endLine: best.end + 1,
    lineDiffs: computeLineDiffs(oldLines, origLines, best.start, best.end),
  };
}

function computeLineDiffs(
  oldLines: string[],
  origLines: string[],
  start: number,
  end: number,
): { lineNumber: number; yours: string; file: string }[] {
  const m = oldLines.length;
  const n = end - start + 1;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.max(
        dp[i - 1][j],
        dp[i][j - 1],
        dp[i - 1][j - 1] + lineSim(oldLines, origLines, i - 1, start + j - 1),
      );
    }
  }

  const pairs: { fi: number; oi: number; sim: number }[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (dp[i][j] === dp[i - 1][j]) {
      i--;
    } else if (dp[i][j] === dp[i][j - 1]) {
      j--;
    } else {
      pairs.push({
        fi: i - 1,
        oi: start + j - 1,
        sim: lineSim(oldLines, origLines, i - 1, start + j - 1),
      });
      i--;
      j--;
    }
  }

  return pairs
    .filter((p) => p.sim < 1)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, MAX_DIFF_HINTS)
    .map((p) => ({
      lineNumber: p.oi + 1,
      yours: oldLines[p.fi],
      file: origLines[p.oi],
    }));
}

function lineSim(oldLines: string[], origLines: string[], fi: number, oi: number): number {
  return similarity(origLines[oi].trim(), oldLines[fi].trim());
}
