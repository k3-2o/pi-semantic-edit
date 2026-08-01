// The 9-pass fuzzy matching chain — faithful port of OpenDev's passes.rs.
//
// Each pass takes (original, oldContent) and returns the ACTUAL substring found
// in the original, or null. Inputs are LF-normalized by the caller (chain.ts),
// mirroring OpenDev's find_match().
//
// SAFETY INVARIANT (inherited from OpenDev): every pass only returns text that
// is literally present in `original` — candidates are re-verified with
// `original.includes(actual)` before being returned. A pass can never return
// text that isn't in the file.

import { similarity } from './similarity';

export type PassFind = (original: string, oldContent: string) => string | null;

// ---------------------------------------------------------------------------
// Pass 1: Simple — exact string match
// ---------------------------------------------------------------------------

export function simpleFind(original: string, oldContent: string): string | null {
  return original.includes(oldContent) ? oldContent : null;
}

// ---------------------------------------------------------------------------
// Pass 2: LineTrimmed — trim each line before comparing
// ---------------------------------------------------------------------------

export function lineTrimmedFind(original: string, oldContent: string): string | null {
  const oldLines = oldContent.split('\n');
  const oldTrimmed = oldLines.map((l) => l.trim());

  if (oldTrimmed.length === 0 || oldTrimmed.every((l) => l.length === 0)) return null;

  const originalLines = original.split('\n');

  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== oldTrimmed[0]) continue;
    if (i + oldTrimmed.length > originalLines.length) continue;
    const allMatch = oldTrimmed.every((oldLn, j) => originalLines[i + j].trim() === oldLn);
    if (allMatch) {
      const actual = originalLines.slice(i, i + oldTrimmed.length).join('\n');
      if (original.includes(actual)) return actual;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass 3: BlockAnchor — first/last lines anchor, middle uses similarity
// ---------------------------------------------------------------------------

export function blockAnchorFind(original: string, oldContent: string): string | null {
  const oldLines = oldContent.split('\n');
  if (oldLines.length < 3) return null;

  const firstTrimmed = oldLines[0].trim();
  const lastTrimmed = oldLines[oldLines.length - 1].trim();
  const middleOld = oldLines.slice(1, -1).map((l) => l.trim());

  const originalLines = original.split('\n');
  const candidates: { start: number; end: number; sim: number }[] = [];

  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstTrimmed) continue;
    const windowEnd = Math.min(i + oldLines.length * 2, originalLines.length);
    for (let endIdx = i + oldLines.length - 1; endIdx < windowEnd; endIdx++) {
      if (endIdx >= originalLines.length) break;
      if (originalLines[endIdx].trim() !== lastTrimmed) continue;
      const middleOrig = originalLines.slice(i + 1, endIdx).map((l) => l.trim());

      let sim: number;
      if (middleOld.length === 0 && middleOrig.length === 0) {
        sim = 1.0;
      } else if (middleOld.length === 0 || middleOrig.length === 0) {
        continue;
      } else {
        sim = similarity(middleOld.join('\n'), middleOrig.join('\n'));
      }
      candidates.push({ start: i, end: endIdx, sim });
    }
  }

  if (candidates.length === 0) return null;

  const threshold = candidates.length === 1 ? 0.0 : 0.3;
  let best = candidates[0];
  for (const c of candidates) if (c.sim > best.sim) best = c;
  if (best.sim < threshold) return null;

  const actual = originalLines.slice(best.start, best.end + 1).join('\n');
  return original.includes(actual) ? actual : null;
}

// ---------------------------------------------------------------------------
// Pass 4: WhitespaceNormalized — collapse whitespace runs per line
// ---------------------------------------------------------------------------

function wsNormalize(s: string): string {
  return s
    .split('\n')
    .map((ln) => ln.replace(/\s+/g, ' ').trim())
    .join('\n');
}

export function whitespaceNormalizedFind(original: string, oldContent: string): string | null {
  const normOld = wsNormalize(oldContent);
  const originalLines = original.split('\n');
  const oldLineCount = oldContent.split('\n').length;

  for (let i = 0; i < originalLines.length; i++) {
    const endMax = Math.min(i + oldLineCount + 2, originalLines.length);
    for (let j = i + oldLineCount - 1; j <= endMax; j++) {
      if (j > originalLines.length) break;
      const candidate = originalLines.slice(i, j).join('\n');
      if (wsNormalize(candidate) === normOld && original.includes(candidate)) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass 5: IndentationFlexible — ignore indentation entirely, skip blank lines
// ---------------------------------------------------------------------------

export function indentationFlexibleFind(original: string, oldContent: string): string | null {
  const oldStripped = oldContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (oldStripped.length === 0) return null;

  const originalLines = original.split('\n');

  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== oldStripped[0]) continue;
    const matchedIndices: number[] = [];
    let j = 0;
    const searchEnd = Math.min(i + oldStripped.length * 3, originalLines.length);
    for (let k = i; k < searchEnd; k++) {
      if (j >= oldStripped.length) break;
      const origLine = originalLines[k];
      if (origLine.trim().length === 0) continue; // skip blank lines
      if (origLine.trim() === oldStripped[j]) {
        matchedIndices.push(k);
        j += 1;
      } else {
        break;
      }
    }

    if (j === oldStripped.length && matchedIndices.length > 0) {
      const start = matchedIndices[0];
      const end = matchedIndices[matchedIndices.length - 1] + 1;
      const actual = originalLines.slice(start, end).join('\n');
      if (original.includes(actual)) return actual;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass 6: EscapeNormalized — unescape common escape sequences
// ---------------------------------------------------------------------------

function unescape(s: string): string {
  // Rust's str::replace replaces ALL occurrences — JS String.replace only the
  // first, so use replaceAll for parity.
  return s
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\\\', '\\')
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}

export function escapeNormalizedFind(original: string, oldContent: string): string | null {
  const unescaped = unescape(oldContent);
  if (unescaped === oldContent) return null; // no escapes to normalize
  return original.includes(unescaped) ? unescaped : null;
}

// ---------------------------------------------------------------------------
// Pass 7: TrimmedBoundary — trim first/last lines, expand to full lines
// ---------------------------------------------------------------------------

export function trimmedBoundaryFind(original: string, oldContent: string): string | null {
  const trimmed = oldContent.trim();
  if (trimmed === oldContent) return null; // nothing to trim

  if (original.includes(trimmed)) return trimmed;

  // Try line-level boundary expansion
  const oldLines = oldContent.split('\n');
  const firstContent = oldLines[0].trim();
  const lastContent = oldLines[oldLines.length - 1].trim();

  if (firstContent.length === 0 || lastContent.length === 0) return null;

  const originalLines = original.split('\n');
  for (let i = 0; i < originalLines.length; i++) {
    if (!originalLines[i].includes(firstContent)) continue;
    const end = Math.min(i + oldLines.length + 2, originalLines.length);
    for (let j = i + 1; j < end; j++) {
      if (j >= originalLines.length) break;
      if (!originalLines[j].includes(lastContent)) continue;
      const candidate = originalLines.slice(i, j + 1).join('\n');
      if (original.includes(candidate)) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass 8: ContextAware — use surrounding context to locate position
// ---------------------------------------------------------------------------

export function contextAwareFind(original: string, oldContent: string): string | null {
  const oldLines = oldContent.split('\n');
  if (oldLines.length < 2) return null;

  const firstCtx = oldLines.find((l) => l.trim().length > 0)?.trim();
  const lastCtx = [...oldLines]
    .reverse()
    .find((l) => l.trim().length > 0)
    ?.trim();
  if (!firstCtx || !lastCtx) return null;

  const originalLines = original.split('\n');

  const starts: number[] = [];
  originalLines.forEach((l, i) => {
    if (l.trim().includes(firstCtx)) starts.push(i);
  });

  if (starts.length === 0) return null;

  let bestMatch: string | null = null;
  let bestSim = 0.0;

  for (const start of starts) {
    const searchEnd = Math.min(start + oldLines.length * 2, originalLines.length);
    for (let end = start + 1; end < searchEnd; end++) {
      if (originalLines[end].trim().includes(lastCtx)) {
        const candidate = originalLines.slice(start, end + 1).join('\n');
        const sim = similarity(oldContent.trim(), candidate.trim());
        if (sim > bestSim && sim > 0.5) {
          bestSim = sim;
          bestMatch = candidate;
        }
        break; // only check first end anchor per start
      }
    }
  }

  return bestMatch !== null && original.includes(bestMatch) ? bestMatch : null;
}

// ---------------------------------------------------------------------------
// Pass 9: MultiOccurrence — trimmed line-by-line match as last resort
// ---------------------------------------------------------------------------

export function multiOccurrenceFind(original: string, oldContent: string): string | null {
  const trimmed = oldContent.trim();
  if (trimmed.length === 0) return null;

  const originalLines = original.split('\n');
  const trimmedLines = trimmed.split('\n');

  if (trimmedLines.length > originalLines.length) return null;

  for (let i = 0; i <= originalLines.length - trimmedLines.length; i++) {
    const candidateLines = originalLines.slice(i, i + trimmedLines.length);
    const allMatch = candidateLines.every((a, idx) => a.trim() === trimmedLines[idx].trim());
    if (allMatch) {
      const candidate = candidateLines.join('\n');
      if (original.includes(candidate)) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chain registry — single source of truth for pass order (OpenDev parity)
// ---------------------------------------------------------------------------

export interface Replacer {
  name: string;
  find: PassFind;
}

export const REPLACER_CHAIN: readonly Replacer[] = [
  { name: 'simple', find: simpleFind },
  { name: 'line_trimmed', find: lineTrimmedFind },
  { name: 'block_anchor', find: blockAnchorFind },
  { name: 'whitespace_normalized', find: whitespaceNormalizedFind },
  { name: 'indentation_flexible', find: indentationFlexibleFind },
  { name: 'escape_normalized', find: escapeNormalizedFind },
  { name: 'trimmed_boundary', find: trimmedBoundaryFind },
  { name: 'context_aware', find: contextAwareFind },
  { name: 'multi_occurrence', find: multiOccurrenceFind },
];
