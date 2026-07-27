/**
 * Core matching engine for robust search/replace edits.
 *
 * Layers:
 * 1. Exact match — content.indexOf(oldText)
 * 2. Normalized match — content and oldText normalized for whitespace/unicode
 * 3. Anchor-constrained match — search only inside a unique anchor region
 * 4. Auto-expanding context — grow oldText outward until unique
 * 5. Joint old/new scoring — when oldText is ambiguous, use the old/new
 *    relationship to score each candidate and pick the best fit.
 */

import type { Edit, MatchResult, ApplyResult, MatcherOptions } from './types';

export type { Edit, MatchResult, ApplyResult, MatcherOptions };

const DEFAULT_OPTIONS: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
  allowJointScoring: true,
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
      // Even joint scoring couldn't disambiguate
      failed.push({
        edit,
        reason: `Found multiple ambiguous occurrences of oldText in file for edits[${i}]. Try adding an anchor or providing more context.`,
      });
      continue;
    }

    const before = currentContent.slice(0, match.start);
    const after = currentContent.slice(match.end);
    const newBlock = normalizeNewlines(edit.newText);
    currentContent = before + newBlock + after;
    matches.push({ ...(match as MatchResult), edit });
  }

  // Post-replacement coherence check
  const warnings = coherenceCheck(currentContent);

  return {
    newContent: currentContent,
    matches,
    failed,
    warnings: warnings.length > 0 ? warnings : undefined,
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
      }
    }
  }

  // Layer 4: auto-expanding context
  if (opts.allowExpand && opts.maxExpandLines && opts.maxExpandLines > 0) {
    const expanded = tryAutoExpand(content, edit, opts);
    if (expanded) return expanded;
  }

  // Layer 5: token fingerprint matching — use identifier relationships
  if (multipleExact) {
    const tf = tokenFingerprintMatch(content, edit);
    if (tf) return tf;
  }

  // Layer 6: joint old/new scoring — disambiguate using the edit relationship
  if (opts.allowJointScoring && multipleExact) {
    const scored = jointScoreMatch(content, edit);
    if (scored) return scored;
  }

  if (multipleExact) return { start: -1, end: -1 };

  return null;
}

/**
 * Token fingerprint matching: use identifier relationships between oldText
 * and newText to disambiguate structurally identical blocks that differ
 * only in variable/function names.
 */
function tokenFingerprintMatch(content: string, edit: Edit): MatchResult | null {
  const oldNorm = normalizeNewlines(edit.oldText);
  const newNorm = normalizeNewlines(edit.newText);
  const oldIds = extractIdentifiers(oldNorm);
  const newIds = extractIdentifiers(newNorm);
  const oldIdSet = new Set(oldIds);
  const preservedIds = newIds.filter((id) => oldIdSet.has(id));
  if (preservedIds.length === 0) return null;
  const candidates = findAllPositions(content, oldNorm);
  if (candidates.length <= 1) return null;
  let bestScore = 0;
  let bestMatch: { start: number; end: number } | null = null;
  for (const { start, end } of candidates) {
    const region = content.slice(Math.max(0, start - 200), Math.min(content.length, end + 200));
    const localIds = extractIdentifiers(region);
    const localSet = new Set(localIds);
    let score = 0;
    for (const id of preservedIds) {
      if (localSet.has(id)) score++;
    }
    const addedIds = newIds.filter((id) => !oldIdSet.has(id));
    const removedIds = oldIds.filter((id) => !new Set(newIds).has(id));
    for (const id of removedIds) {
      if (localSet.has(id)) score++;
    }
    for (const id of addedIds) {
      if (!localSet.has(id)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { start, end };
    }
  }
  if (bestMatch && bestScore > 0) {
    return {
      start: bestMatch.start,
      end: bestMatch.end,
      usedFuzzy: false,
      usedNormalized: false,
      description: `token-fingerprint match (score: ${bestScore})`,
    };
  }
  return null;
}

/**
 * Extract simple identifiers from code text, excluding language keywords.
 */
function extractIdentifiers(text: string): string[] {
  const regex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
  const keywords = new Set([
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'throw',
    'try',
    'catch',
    'finally',
    'function',
    'class',
    'var',
    'let',
    'const',
    'import',
    'export',
    'from',
    'def',
    'in',
    'not',
    'and',
    'or',
    'true',
    'false',
    'null',
    'undefined',
    'void',
    'typeof',
    'instanceof',
    'new',
    'this',
    'super',
    'yield',
    'await',
    'async',
    'static',
    'get',
    'set',
    'public',
    'private',
    'protected',
    'readonly',
    'int',
    'float',
    'double',
    'char',
    'bool',
    'string',
    'fn',
    'mut',
  ]);
  const matches = text.match(regex);
  if (!matches) return [];
  return matches.filter((id) => !keywords.has(id));
}

/**
 * Joint old/new scoring: when oldText matches multiple locations, evaluate
 * each candidate by simulating the replacement and scoring the result.
 *
 * Scoring factors:
 * - Structural coherence (brace balance, indentation) — higher is better
 * - Context continuity (unchanged surrounding lines should remain unchanged)
 * - The new text should not create duplicate adjacent code
 */
function jointScoreMatch(content: string, edit: Edit): MatchResult | null {
  const oldNorm = normalizeNewlines(edit.oldText);
  const newNorm = normalizeNewlines(edit.newText);
  const candidates = findAllPositions(content, oldNorm);
  if (candidates.length === 0) return null;

  let bestScore = -Infinity;
  let bestMatch: { start: number; end: number } | null = null;

  for (const { start, end } of candidates) {
    // Simulate the replacement
    const before = content.slice(0, start);
    const after = content.slice(end);
    const result = before + newNorm + after;

    const score = computeCoherenceScore(content, result, start, end, oldNorm, newNorm);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { start, end };
    }
  }

  if (bestMatch && bestScore > 0) {
    return {
      start: bestMatch.start,
      end: bestMatch.end,
      usedFuzzy: false,
      usedNormalized: false,
      description: `joint-scored match (score: ${bestScore.toFixed(1)})`,
    };
  }

  return null;
}

/**
 * Compute a coherence score for a candidate replacement.
 *
 * Factors:
 * 1. Brace/paren/bracket balance: how much the balance changes
 * 2. Indentation consistency: comparing indentation of lines around the edit
 * 3. Line count: prefer edits that maintain similar line counts (less likely to be accidental)
 * 4. Context preservation: lines outside the edit region should be identical
 */
function computeCoherenceScore(
  originalContent: string,
  newContent: string,
  editStart: number,
  editEnd: number,
  oldNorm: string,
  newNorm: string,
): number {
  const BONUS_BALANCE = 30;
  const BONUS_SAME_LINE_COUNT = 10;
  const PENALTY_DUPLICATE = -15;
  const PENALTY_BRACE_IMBALANCE = -50;

  let score = 0;

  // 1. Context preservation: lines outside the edit must be identical
  const beforeEdit = originalContent.slice(0, editStart);
  const afterEdit = originalContent.slice(editEnd);
  const newBeforeEdit = newContent.slice(0, editStart);
  const newAfterEdit = newContent.slice(newContent.length - afterEdit.length);

  if (beforeEdit !== newBeforeEdit || afterEdit !== newAfterEdit) {
    // The harness changes content outside the edit, which is a strong negative signal
    score -= 30;
  }

  // 2. Brace balance: compare before vs after balance
  const originalBal = braceBalance(originalContent);
  const newBal = braceBalance(newContent);
  if (newBal >= 0 && originalBal >= 0) {
    if (newBal === originalBal) {
      score += BONUS_BALANCE;
    } else {
      score += PENALTY_BRACE_IMBALANCE;
    }
  }

  // 3. Same-line-count bonus
  const oldLines = oldNorm.split('\n').length;
  const newLines = newNorm.split('\n').length;
  if (oldLines === newLines) {
    score += BONUS_SAME_LINE_COUNT;
  }

  // 4. Duplicate detection: if newNorm already exists nearby, penalize
  const contextAround = 5; // lines around the edit
  const contentLines = newContent.split('\n');
  const editLineIdx = findLineIndexFromOffset(contentLines, editStart);
  const startContext = Math.max(0, editLineIdx - contextAround);
  const endContext = Math.min(contentLines.length, editLineIdx + contextAround + 1);
  for (let i = startContext; i < endContext; i++) {
    if (i !== editLineIdx && contentLines[i]?.includes(newNorm.trim())) {
      score += PENALTY_DUPLICATE;
      break;
    }
  }

  // 5. Prefer candidate where the old text matches the structure of surrounding code
  // (e.g., same indentation level as neighboring lines)
  const oldLine = originalContent.slice(editStart, editEnd).split('\n')[0] ?? '';
  const indentLevel = oldLine.search(/\S/); // first non-whitespace
  if (indentLevel >= 0) {
    const lines = originalContent.split('\n');
    const idx = findLineIndexFromOffset(lines, editStart);
    // Check surrounding lines for similar indentation
    let similarIndentCount = 0;
    for (let di = -2; di <= 2; di++) {
      const neighborIdx = idx + di;
      if (neighborIdx >= 0 && neighborIdx < lines.length && neighborIdx !== idx) {
        const neighborIndent = lines[neighborIdx].search(/\S/);
        if (neighborIndent >= 0 && Math.abs(neighborIndent - indentLevel) <= 1) {
          similarIndentCount++;
        }
      }
    }
    score += similarIndentCount * 2;
  }

  return score;
}

/** Simple brace/parenthesis/bracket balance. Returns count of open vs close, or -1 if mismatch type. */
function braceBalance(text: string): number {
  let open = 0;
  for (const ch of text) {
    if (ch === '{' || ch === '(' || ch === '[') open++;
    if (ch === '}' || ch === ')' || ch === ']') open--;
  }
  return open;
}

/** Find all positions of target in content. */
function findAllPositions(content: string, target: string): { start: number; end: number }[] {
  if (target.length === 0) return [];
  const positions: { start: number; end: number }[] = [];
  let pos = 0;
  for (;;) {
    const idx = content.indexOf(target, pos);
    if (idx === -1) break;
    positions.push({ start: idx, end: idx + target.length });
    pos = idx + target.length;
  }
  return positions;
}

// ---- Existing layers (unchanged below) ---- //

/** Try exact match with uniqueness check. */
function exactMatch(content: string, oldNorm: string): MatchResult | -1 | -2 {
  const idx = content.indexOf(oldNorm);
  if (idx === -1) return -1;
  const nextIdx = content.indexOf(oldNorm, idx + oldNorm.length);
  if (nextIdx !== -1) return -2;
  return {
    start: idx,
    end: idx + oldNorm.length,
    usedFuzzy: false,
    usedNormalized: false,
  };
}

/** Auto-expand: try to find a unique match by expanding context around each occurrence. */
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

function findLineIndex(lines: string[], offset: number): number {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += lines[i].length + 1;
    if (total > offset) return i;
  }
  return lines.length - 1;
}

function findLineIndexFromOffset(lines: string[], offset: number): number {
  return findLineIndex(lines, offset);
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

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

/**
 * Post-replacement coherence check: scan the result for structural integrity
 * issues that could indicate a wrong-location edit.
 *
 * Checks:
 * - Brace/paren/bracket balance: closing should match opening count.
 * - Indentation consistency: drastic jumps away from neighboring lines.
 *
 * Returns a list of warning messages. Empty list means no issues.
 */
function coherenceCheck(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split('\n');

  // Brace/paren/bracket balance
  let balance = 0;
  for (const ch of content) {
    if (ch === '{' || ch === '(' || ch === '[') balance++;
    if (ch === '}' || ch === ')' || ch === ']') balance--;
  }

  if (balance > 0) {
    warnings.push(`Unclosed ${balance} brace(s)/paren(s)/bracket(s).`);
  } else if (balance < 0) {
    warnings.push(`Too many closing braces/parens/brackets (excess: ${-balance}).`);
  }

  // Indentation consistency: check for drastic jumps
  if (lines.length > 2) {
    let prevIndent = lines[0].search(/\S/);
    if (prevIndent < 0) prevIndent = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const indent = line.search(/\S/);
      if (indent < 0) continue;

      const nonEmptyPrev = findPrevNonEmptyLine(lines, i);
      if (nonEmptyPrev !== -1) {
        const prevIndent2 = lines[nonEmptyPrev].search(/\S/);
        if (prevIndent2 >= 0 && Math.abs(indent - prevIndent2) > 4) {
          warnings.push(
            `Line ${i + 1} has suspicious indentation jump (from ${prevIndent2} to ${indent} spaces).`,
          );
        }
      }

      if (indent >= 0) prevIndent = indent;
    }
  }

  return warnings;
}

function findPrevNonEmptyLine(lines: string[], currentIdx: number): number {
  for (let i = currentIdx - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) return i;
  }
  return -1;
}
