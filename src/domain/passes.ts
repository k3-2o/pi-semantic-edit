// --- 9-pass fuzzy chain — port of OpenDev passes.rs; inputs LF-normalized by caller (chain.ts) ---
// --- SAFETY INVARIANT: a pass returns only text re-verified in original (original.includes(actual)) — never text not in the file ---

import { similarity } from './similarity';

type PassFind = (original: string, oldContent: string) => string | null;

// --- Pass 1: Simple (exact match) ---

export function simpleFind(original: string, oldContent: string): string | null {
  return original.includes(oldContent) ? oldContent : null;
}

// --- Pass 2: LineTrimmed ---

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

// --- Pass 3: BlockAnchor (first/last lines anchor, middle scored) ---

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

  // --- Threshold: 0.0 for a single candidate, 0.3 when multiple exist ---
  const threshold = candidates.length === 1 ? 0.0 : 0.3;
  let best = candidates[0];
  for (const c of candidates) if (c.sim > best.sim) best = c;
  if (best.sim < threshold) return null;

  const actual = originalLines.slice(best.start, best.end + 1).join('\n');
  return original.includes(actual) ? actual : null;
}

// --- Pass 4: WhitespaceNormalized ---

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

// --- Pass 5: IndentationFlexible ---

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
      if (origLine.trim().length === 0) continue;
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

// --- Pass 6: EscapeNormalized ---

function unescape(s: string): string {
  // --- Rust str::replace replaces ALL; JS String.replace only the first — replaceAll required for parity ---
  return s
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\\\', '\\')
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}

export function escapeNormalizedFind(original: string, oldContent: string): string | null {
  const unescaped = unescape(oldContent);
  if (unescaped === oldContent) return null;
  return original.includes(unescaped) ? unescaped : null;
}

// --- Pass 7: TrimmedBoundary ---

export function trimmedBoundaryFind(original: string, oldContent: string): string | null {
  const trimmed = oldContent.trim();
  if (trimmed === oldContent) return null;

  if (original.includes(trimmed)) return trimmed;

  // --- Fallback: first/last content lines as contains-anchors ---
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

// --- Pass 8: ContextAware ---

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
        break; // --- first end anchor per start only ---
      }
    }
  }

  return bestMatch !== null && original.includes(bestMatch) ? bestMatch : null;
}

// --- Pass 9: MultiOccurrence (trimmed line-by-line, last resort) ---

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

// --- Pass 10: UnicodeNormalized (our addition) — NFKC + punct map ---
// --- NFKC covers NBSP/ligatures but NOT typographic quotes/dashes (no compatibility decomposition) — PUNCT_MAP covers those; after the 9 OpenDev passes for parity ---

const PUNCT_MAP: Record<string, string> = {
  '\u2018': "'", // ‘ left single quote
  '\u2019': "'", // ’ right single quote
  '\u201A': "'", // ‚ single low-9 quote
  '\u201B': "'", // ‛ single high-reversed-9 quote
  '\u201C': '"', // “ left double quote
  '\u201D': '"', // ” right double quote
  '\u201E': '"', // „ double low-9 quote
  '\u201F': '"', // ‟ double high-reversed-9 quote
  '\u2013': '-', // – en dash
  '\u2014': '-', // — em dash
};

function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(
      /[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2013\u2014]/g,
      (c) => PUNCT_MAP[c] ?? c,
    );
}

// --- ASCII fast-path: lets the common case skip normalization entirely ---
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return false;
  }
  return true;
}

function mapNormalizedIndex(s: string, normIndex: number): number {
  let consumed = 0;
  for (let i = 0; i < s.length; i++) {
    const n = normalizeText(s[i]).length;
    if (consumed + n > normIndex) return i;
    consumed += n;
    if (consumed === normIndex) return i + 1;
  }
  return s.length;
}

export function unicodeNormalizedFind(original: string, oldContent: string): string | null {
  const normOld = normalizeText(oldContent);
  // --- Skip when query already normalized and file is pure ASCII; non-ASCII files may hold ligatures ---
  if (normOld === oldContent && isAscii(original)) return null;
  const normOrig = normalizeText(original);
  const idx = normOrig.indexOf(normOld);
  if (idx === -1) return null;
  const start = mapNormalizedIndex(original, idx);
  const end = mapNormalizedIndex(original, idx + normOld.length);
  const actual = original.slice(start, end);
  return original.includes(actual) ? actual : null;
}

// --- Chain registry — single source of truth for pass order ---

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
  { name: 'unicode_normalized', find: unicodeNormalizedFind },
];
