/**
 * Core matching engine for robust search/replace edits.
 *
 * Layers:
 * 1. Exact match — content.indexOf(oldText)
 * 2. Normalized match — content and oldText normalized for whitespace/unicode
 * 3. Anchor-constrained match — search only inside a unique anchor region
 * 4. Auto-expanding context — grow oldText outward until unique
 */

import type { Edit, MatchResult, ApplyResult, MatcherOptions } from './types';

export type { Edit, MatchResult, ApplyResult, MatcherOptions };

const DEFAULT_OPTIONS: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
};

/**
 * Apply a set of edits to file content.
 * All edits are matched against the **original** content snapshot.
 * Edits are applied bottom-up to maintain offset stability.
 * The content is expected to be LF-normalized. Returned content is LF-normalized.
 */
export function applyEdits(
  content: string,
  edits: Edit[],
  options: MatcherOptions = {},
): ApplyResult {
  // Normalize input content to LF for consistent matching
  const lfContent = normalizeNewlines(content);
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const matches: (MatchResult & { edit: Edit })[] = [];
  const failed: { edit: Edit; reason: string }[] = [];
  let currentContent = lfContent;

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    const match = findMatch(currentContent, edit, opts);
    if (!match) {
      failed.push({
        edit,
        reason: `Could not find matching text for edits[${i}]. Try adding an anchor or providing more context.`,
      });
      continue;
    }
    if (match.start === -1) {
      failed.push({
        edit,
        reason: `Found multiple occurrences of oldText in file for edits[${i}]. Try adding an anchor or providing more context.`,
      });
      continue;
    }

    const before = currentContent.slice(0, match.start);
    const after = currentContent.slice(match.end);
    const newBlock = normalizeNewlines(edit.newText);
    currentContent = before + newBlock + after;
    matches.push({ ...(match as MatchResult), edit });
  }

  return {
    newContent: currentContent,
    matches,
    failed,
  };
}

/**
 * Find oldText in content using layered matching.
 * Returns match on success, null if completely not found,
 * or {start:-1} if found in multiple ambiguous locations.
 */
function findMatch(
  content: string,
  edit: Edit,
  opts: MatcherOptions,
): MatchResult | null | { start: -1; end: -1 } {
  const oldNorm = normalizeNewlines(edit.oldText);

  // Empty oldText cannot match
  if (oldNorm.length === 0) return null;

  // Layer 1: exact match
  let multipleExact = false;
  {
    const result = exactMatch(content, oldNorm);
    if (result !== -1 && result !== -2) return result;
    if (result === -2) multipleExact = true;
  }

  // Layer 2: anchor-constrained match
  if (edit.anchor) {
    const anchorNorm = normalizeNewlines(edit.anchor);
    const anchorIdx = content.indexOf(anchorNorm);
    if (anchorIdx !== -1) {
      const anchorEnd = anchorIdx + anchorNorm.length;
      const region = content.slice(anchorIdx, anchorEnd);
      const localIdx = region.indexOf(oldNorm);
      if (localIdx !== -1) {
        return {
          start: anchorIdx + localIdx,
          end: anchorIdx + localIdx + oldNorm.length,
          usedFuzzy: false,
          usedNormalized: false,
          description: `matched inside anchor "${edit.anchor}"`,
        };
      }
    }
    // Try with normalized matching inside anchor
    if (opts.allowNormalized) {
      const fuzzyContent = normalizeForMatching(content);
      const fuzzyOld = normalizeForMatching(edit.oldText);
      if (fuzzyOld.length > 0) {
        const fuzzyAnchor = normalizeForMatching(edit.anchor);
        const anchorFuzzyIdx = fuzzyContent.indexOf(fuzzyAnchor);
        if (anchorFuzzyIdx !== -1) {
          const anchorFuzzyEnd = anchorFuzzyIdx + fuzzyAnchor.length;
          const region = fuzzyContent.slice(anchorFuzzyIdx, anchorFuzzyEnd);
          const localFuzzyIdx = region.indexOf(fuzzyOld);
          if (localFuzzyIdx !== -1) {
            const matchStart = anchorFuzzyIdx + localFuzzyIdx;
            return {
              start: matchStart,
              end: matchStart + fuzzyOld.length,
              usedFuzzy: true,
              usedNormalized: true,
              description: `fuzzy matched inside anchor "${edit.anchor}"`,
            };
          }
        }
      }
    }
  }

  // Layer 3: normalized (fuzzy) match
  if (opts.allowNormalized && oldNorm.length > 0) {
    const fuzzyContent = normalizeForMatching(content);
    const fuzzyOld = normalizeForMatching(edit.oldText);
    if (fuzzyOld.length > 0) {
      const idx = fuzzyContent.indexOf(fuzzyOld);
      if (idx !== -1) {
        // Check uniqueness in normalized space
        const nextIdx = fuzzyContent.indexOf(fuzzyOld, idx + fuzzyOld.length);
        if (nextIdx === -1) {
          return {
            start: idx,
            end: idx + fuzzyOld.length,
            usedFuzzy: true,
            usedNormalized: true,
            description: 'normalized match (whitespace/unicode tolerant)',
          };
        }
        // Multiple occurrences in fuzzy space — falls through to expand
      }
    }
  }

  // Layer 4: auto-expanding context
  if (opts.allowExpand && opts.maxExpandLines && opts.maxExpandLines > 0) {
    const expanded = tryAutoExpand(content, edit, opts);
    if (expanded) return expanded;
  }

  // Fallback: if we know oldText exists but couldn't resolve, report multiple
  if (multipleExact) return { start: -1, end: -1 };

  return null;
}

/**
 * Try exact match with uniqueness check.
 * Returns MatchResult on success, -2 if multiple occurrences, -1 if not found.
 */
function exactMatch(content: string, oldNorm: string): MatchResult | -1 | -2 {
  const idx = content.indexOf(oldNorm);
  if (idx === -1) return -1;

  const nextIdx = content.indexOf(oldNorm, idx + oldNorm.length);
  if (nextIdx !== -1) return -2; // multiple occurrences

  return {
    start: idx,
    end: idx + oldNorm.length,
    usedFuzzy: false,
    usedNormalized: false,
  };
}

/**
 * Auto-expand: try to find a unique match by expanding context around each occurrence.
 * Grows the searched block outward until only one occurrence matches uniquely.
 */
function tryAutoExpand(content: string, edit: Edit, opts: MatcherOptions): MatchResult | null {
  const oldNorm = normalizeNewlines(edit.oldText);
  if (oldNorm.length === 0) return null;

  const lines = content.split('\n');
  const maxExpand = opts.maxExpandLines ?? 10;

  const occurrences = findOccurrences(content, oldNorm);
  if (occurrences.length <= 1) return null;

  for (let expandSize = 1; expandSize <= maxExpand; expandSize++) {
    for (const occStart of occurrences) {
      const occLineIdx = findLineIndex(lines, occStart);
      if (occLineIdx === -1) continue;

      const startLine = Math.max(0, occLineIdx - expandSize);
      const endLine = Math.min(lines.length, occLineIdx + expandSize + 1);
      const expandedBlock = lines.slice(startLine, endLine).join('\n');

      const matches = findOccurrences(content, expandedBlock);
      if (matches.length === 1) {
        const blockStart = matches[0];
        const blockContent = content.slice(blockStart, blockStart + expandedBlock.length);
        const localIdx = blockContent.indexOf(oldNorm);
        if (localIdx !== -1) {
          return {
            start: blockStart + localIdx,
            end: blockStart + localIdx + oldNorm.length,
            usedFuzzy: false,
            usedNormalized: false,
            description: `auto-expanded context by ${expandSize} lines`,
          };
        }
      }
    }
  }

  return null;
}

/** Find all occurrences of target string in content. Returns empty array if target is empty. */
function findOccurrences(content: string, target: string): number[] {
  if (target.length === 0) return [];
  const positions: number[] = [];
  let pos = 0;
  for (;;) {
    const idx = content.indexOf(target, pos);
    if (idx === -1) break;
    positions.push(idx);
    pos = idx + target.length;
  }
  return positions;
}

/** Find the line index (0-based) that contains the given character offset. */
function findLineIndex(lines: string[], offset: number): number {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += lines[i].length + 1;
    if (total > offset) return i;
  }
  return lines.length - 1;
}

/** Normalize line endings in text to LF. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalize text for fuzzy matching: strip trailing whitespace per line,
 * normalize smart quotes, dashes, special spaces.
 */
function normalizeForMatching(text: string): string {
  return normalizeNewlines(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}
