import { applyEdits } from './apply';
import { findClosestCandidate } from './closest';
import { findMatch } from './chain';
import {
  ambiguousError,
  disproportionateError,
  noOpError,
  notFoundError,
  overlappingError,
  validationError,
} from './errors';
import { reportOccurrences } from './uniqueness';
import type { EditError, EditRequest, FailedEdit, MatchResult, ResolvedEdit } from './types';

const MAX_EXPAND_LINES = 10;

export interface ResolveBlocksResult {
  ok: boolean;
  resolved?: ResolvedEdit[];
  error?: EditError;
}

export function resolveBlocks(
  content: string,
  blocks: EditRequest[],
  path: string,
): ResolveBlocksResult {
  const resolved: ResolvedEdit[] = [];
  for (const block of blocks) {
    if (block.oldText.length === 0) {
      if (content.length === 0) {
        resolved.push({
          edit: { path, oldText: block.oldText, newText: block.newText },
          match: { actual: '', passName: 'simple' },
          start: 0,
          end: 0,
        });
        continue;
      }
      return {
        ok: false,
        error: validationError(
          'oldText is empty and the file is not empty. Quote the first line, or use write.',
        ),
      };
    }
    if (block.oldText === block.newText) {
      return {
        ok: false,
        error: validationError(
          'oldText and newText are identical (no-op). Change newText or drop the edit.',
        ),
      };
    }

    const match = findMatch(content, block.oldText);
    if (!match) {
      const closest = findClosestCandidate(content, block.oldText);
      return { ok: false, error: notFoundError(path, closest ?? undefined) };
    }

    if (isDisproportionateMatch(match.actual, block.oldText)) {
      return { ok: false, error: disproportionateError(path) };
    }

    if (block.replaceAll) {
      const spans = findAllSpans(content, match.actual);
      if (spans.length === 0) {
        return {
          ok: false,
          error: validationError('internal invariant violated: matched text not found in content'),
        };
      }
      for (const span of spans) {
        const actual = content.slice(span.start, span.end);
        if (isDisproportionateMatch(actual, block.oldText)) {
          return { ok: false, error: disproportionateError(path) };
        }
        resolved.push({
          edit: { path, oldText: block.oldText, newText: block.newText },
          match: { ...match, passName: spans.length > 1 ? 'replace_all' : match.passName },
          start: span.start,
          end: span.end,
        });
      }
      continue;
    }

    const report = reportOccurrences(content, match.actual);
    if (report.ambiguous) {
      const expanded = tryAutoExpand(content, block, path, match.actual);
      if (expanded) {
        resolved.push(expanded);
        continue;
      }
      return { ok: false, error: ambiguousError(path, report.count, report.positions) };
    }

    const start = content.indexOf(match.actual);
    if (start === -1) {
      return {
        ok: false,
        error: validationError('internal invariant violated: matched text not found in content'),
      };
    }

    resolved.push({
      edit: { path, oldText: block.oldText, newText: block.newText },
      match,
      start,
      end: start + match.actual.length,
    });
  }
  return { ok: true, resolved };
}

export interface ApplyBlocksResult {
  ok: boolean;
  content?: string;
  error?: EditError;

  matchPasses: string[];

  spans: { start: number; end: number; passName: string }[];

  replacements: number;
}

export function applyBlocks(
  content: string,
  blocks: EditRequest[],
  path: string,
): ApplyBlocksResult {
  const outcome = resolveBlocks(content, blocks, path);
  if (!outcome.ok || !outcome.resolved) {
    return { ok: false, error: outcome.error, matchPasses: [], spans: [], replacements: 0 };
  }

  const result = applyEdits(content, outcome.resolved);
  if (result.failed.length > 0) {
    return {
      ok: false,
      error: failureToError(result.failed[0]),
      matchPasses: [],
      spans: [],
      replacements: 0,
    };
  }

  return {
    ok: true,
    content: result.content,
    matchPasses: result.applied.map((a) => a.match.passName),
    spans: result.applied.map((a) => ({ start: a.start, end: a.end, passName: a.match.passName })),
    replacements: result.applied.length,
  };
}

function failureToError(f: FailedEdit): EditError {
  switch (f.kind) {
    case 'overlap':
      return overlappingError(f.reason);
    case 'no-op':
      return noOpError();
    case 'invariant':
      return validationError(f.reason);
  }
}

function tryAutoExpand(
  content: string,
  block: EditRequest,
  path: string,
  actual: string,
): ResolvedEdit | null {
  const spans = findAllSpans(content, actual);
  if (spans.length < 2) return null;

  const lines = content.split('\n');
  const lineRanges = spans.map((s) => ({
    startLine: lineIndexAt(lines, s.start),
    endLine: lineIndexAt(lines, s.end - 1),
  }));

  let above = 0;
  let below = 0;
  const half = Math.floor(MAX_EXPAND_LINES / 2);
  const maxLevel = MAX_EXPAND_LINES;

  for (let level = 0; level < maxLevel; level++) {
    if (level % 2 === 0) {
      if (above >= half) continue;
      above++;
    } else {
      if (below >= half) continue;
      below++;
    }

    const expandedBlocks = lineRanges.map(({ startLine, endLine }) => {
      const s = Math.max(0, startLine - above);
      const e = Math.min(lines.length, endLine + 1 + below);
      return lines.slice(s, e).join('\n');
    });

    const uniqueIdx = findSingleUnique(expandedBlocks, content);
    if (uniqueIdx !== null) {
      if (countOccurrences(expandedBlocks[uniqueIdx], actual) > 1) return null;
      const span = spans[uniqueIdx];
      return {
        edit: { path, oldText: block.oldText, newText: block.newText },
        match: { actual, passName: 'auto_expand' } satisfies MatchResult,
        start: span.start,
        end: span.end,
      };
    }

    if (expandedBlocks.filter((b) => countOccurrences(content, b) === 1).length > 1) return null;
  }
  return null;
}

function findAllSpans(content: string, needle: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let from = 0;
  while (from <= content.length) {
    const idx = content.indexOf(needle, from);
    if (idx === -1) break;
    spans.push({ start: idx, end: idx + needle.length });
    from = idx + 1;
  }
  return spans;
}

function isDisproportionateMatch(search: string, oldText: string): boolean {
  const oldLines = oldText.split('\n').length;
  const searchLines = search.split('\n').length;
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true;
  if (oldLines === 1) return false;
  return search.trim().length > Math.max(oldText.trim().length + 500, oldText.trim().length * 4);
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= content.length) {
    const idx = content.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + 1;
  }
  return count;
}

function lineIndexAt(lines: string[], offset: number): number {
  let remaining = offset;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].length + (i < lines.length - 1 ? 1 : 0);
    if (remaining < len) return i;
    remaining -= len;
  }
  return lines.length - 1;
}

function findSingleUnique(blocks: string[], content: string): number | null {
  let uniqueIdx: number | null = null;
  for (let i = 0; i < blocks.length; i++) {
    if (countOccurrences(content, blocks[i]) === 1) {
      if (uniqueIdx !== null) return null;
      uniqueIdx = i;
    }
  }
  return uniqueIdx;
}
