// The edit engine — pure orchestration of the domain pipeline for one file:
// findMatch → uniqueness → closest-candidate → applyEdits. Tool/preview share
// this; it's fully testable without Pi.

import { applyEdits } from './apply';
import { findClosestCandidate } from './closest';
import { findMatch } from './chain';
import {
  ambiguousError,
  noOpError,
  notFoundError,
  overlappingError,
  validationError,
} from './errors';
import { reportOccurrences } from './uniqueness';
import type { EditError, FailedEdit, ParsedBlock, ResolvedEdit } from './types';

export interface ResolveBlocksResult {
  ok: boolean;
  resolved?: ResolvedEdit[];
  error?: EditError;
}

/**
 * Match every block against one content string (non-incremental — all blocks
 * resolve against the ORIGINAL content). Returns the first error on failure:
 * empty search text, no match (with closest candidate), ambiguous match.
 */
export function resolveBlocks(
  content: string,
  blocks: ParsedBlock[],
  path: string,
): ResolveBlocksResult {
  const resolved: ResolvedEdit[] = [];
  for (const block of blocks) {
    if (block.oldText.length === 0) {
      return {
        ok: false,
        error: validationError('SEARCH text is empty; provide the exact code to find.'),
      };
    }
    if (block.oldText === block.newText) {
      return {
        ok: false,
        error: validationError('SEARCH and REPLACE text are identical; this edit does nothing.'),
      };
    }

    const match = findMatch(content, block.oldText);
    if (!match) {
      const closest = findClosestCandidate(content, block.oldText);
      return { ok: false, error: notFoundError(path, closest ?? undefined) };
    }

    const report = reportOccurrences(content, match.actual);
    if (report.ambiguous) {
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
  /** pass names per applied edit (OpenDev match_pass parity). */
  matchPasses: string[];
}

/** Resolve + apply all blocks against one content string. */
export function applyBlocks(
  content: string,
  blocks: ParsedBlock[],
  path: string,
): ApplyBlocksResult {
  const outcome = resolveBlocks(content, blocks, path);
  if (!outcome.ok || !outcome.resolved) {
    return { ok: false, error: outcome.error, matchPasses: [] };
  }

  const result = applyEdits(content, outcome.resolved);
  if (result.failed.length > 0) {
    return { ok: false, error: failureToError(result.failed[0]), matchPasses: [] };
  }

  return {
    ok: true,
    content: result.content,
    matchPasses: result.applied.map((a) => a.match.passName),
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
