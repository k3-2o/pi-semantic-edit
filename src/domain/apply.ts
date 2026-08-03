// --- Applies resolved edits against ORIGINAL content, bottom-up (higher spans first) ---

import type { ApplyResult, ResolvedEdit } from './types';
import { normalizeNewlines } from './utils';

export function applyEdits(content: string, resolved: ResolvedEdit[]): ApplyResult {
  const applied: ApplyResult['applied'] = [];
  const failed: ApplyResult['failed'] = [];

  if (resolved.length === 0) {
    return { content, applied, failed };
  }

  // --- Overlap detection needs ascending spans ---
  const sorted = [...resolved].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.start < prev.end) {
      failed.push({
        edit: curr.edit,
        kind: 'overlap',
        reason: `overlaps the edit at ${prev.start}..${prev.end} (both matched against the original file)`,
      });
    }
  }
  if (failed.length > 0) return { content, applied, failed };

  const pieces: { start: number; end: number; replacement: string; edit: ResolvedEdit }[] = [];
  for (const r of resolved) {
    const replacement = normalizeNewlines(r.edit.newText);
    pieces.push({ start: r.start, end: r.end, replacement, edit: r });
  }
  pieces.sort((a, b) => b.start - a.start);

  let result = content;
  for (const p of pieces) {
    const noOp = p.replacement === p.edit.match.actual;
    if (noOp) {
      failed.push({
        edit: p.edit.edit,
        kind: 'no-op',
        reason: 'edit results in no change (old and new text identical after normalization)',
      });
      continue;
    }
    if (result.slice(p.start, p.end) !== p.edit.match.actual) {
      failed.push({
        edit: p.edit.edit,
        kind: 'invariant',
        reason: 'internal invariant violated: actual text not found at resolved span',
      });
      continue;
    }
    result = result.slice(0, p.start) + p.replacement + result.slice(p.end);
    applied.push({ edit: p.edit.edit, match: p.edit.match });
  }

  return { content: result, applied, failed };
}
