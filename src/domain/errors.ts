// Pure error/message builders. All messages are strings derived from domain
// results — no Pi imports, unit-testable. The pi/tool layer wires these into
// tool output.

import { formatLinePositions } from './uniqueness';
import type { ClosestCandidate, EditError } from './types';

export function staleReadError(): EditError {
  return {
    kind: 'stale-read',
    message:
      'The file has changed since you last read it; re-read the file and retry your edit with the current content.',
  };
}

export function ambiguousError(path: string, count: number, positions: number[]): EditError {
  return {
    kind: 'ambiguous',
    message:
      `SEARCH text found ${count} times at ${formatLinePositions(positions)} in ${path}. ` +
      'Provide more surrounding context to make the match unique.',
    linePositions: positions,
  };
}

export function notFoundError(path: string, closest?: ClosestCandidate): EditError {
  const base = `SEARCH text not found in ${path}. The 9-pass fuzzy matcher found no match.`;
  if (!closest) {
    return { kind: 'not-found', message: base };
  }
  const pct = Math.round(closest.similarity * 100);
  const lines =
    closest.startLine === closest.endLine
      ? `line ${closest.startLine}`
      : `lines ${closest.startLine}-${closest.endLine}`;
  const preview = abbreviate(closest.candidate);
  return {
    kind: 'not-found',
    message:
      `${base}\n` +
      `Closest match (${pct}% similar) at ${lines}:\n${preview}\n` +
      'Compare against the actual file content and retry with the correct text.',
    closestCandidate: closest,
  };
}

export function malformedPatchError(message: string, lineIndex?: number): EditError {
  const at = lineIndex !== undefined ? ` (line ${lineIndex + 1})` : '';
  return { kind: 'malformed-patch', message: `Malformed SEARCH/REPLACE patch${at}: ${message}` };
}

export function missingPathError(): EditError {
  return {
    kind: 'missing-path',
    message: 'Each SEARCH/REPLACE block must be preceded by a file path line (aider format).',
  };
}

export function fileNotFoundError(path: string): EditError {
  return { kind: 'file-not-found', message: `File not found: ${path}` };
}

export function overlappingError(description: string): EditError {
  return { kind: 'overlapping', message: `Overlapping edits: ${description}` };
}

export function noOpError(): EditError {
  return {
    kind: 'no-op',
    message: 'Edit results in no change: the replacement text is identical to the matched text.',
  };
}

export function validationError(message: string): EditError {
  return { kind: 'validation', message };
}

/** Truncate multi-line candidate text for a compact error preview. */
function abbreviate(text: string, maxLines = 8, maxCols = 80): string {
  const lines = text.split('\n').slice(0, maxLines);
  const abridged = lines.map((l) => (l.length > maxCols ? l.slice(0, maxCols) + '…' : l));
  if (text.split('\n').length > maxLines) abridged.push('…');
  return abridged.join('\n');
}
