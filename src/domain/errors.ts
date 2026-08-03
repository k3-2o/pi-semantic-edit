// --- Pure error/message builders — strings from domain results, no Pi imports; tool layer wires them ---

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
      `Text found ${count} times at ${formatLinePositions(positions)} in ${path}. ` +
      'Provide more surrounding context to make the match unique, or set replaceAll: true ' +
      'to replace every occurrence.',
    linePositions: positions,
  };
}

export function notFoundError(path: string, closest?: ClosestCandidate): EditError {
  const base = `Text not found in ${path}. The 10-pass fuzzy matcher found no match.`;
  if (!closest) {
    return {
      kind: 'not-found',
      message:
        `${base}\n` +
        'No similar text found either. Re-read the file to see its current content, then ' +
        'retry with the exact text to replace.',
    };
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
  return {
    kind: 'malformed-patch',
    message: `Malformed SEARCH/REPLACE patch${at}: ${message}`, // --- deprecated aider input only ---
  };
}

export function missingPathError(): EditError {
  return {
    kind: 'missing-path',
    message:
      'Each edit must specify a path (aider blocks need a file path line before the SEARCH marker).',
  };
}

export function disproportionateError(path: string): EditError {
  return {
    kind: 'disproportionate',
    message:
      `Refusing to edit ${path}: the matched span is much larger than the text to find. ` +
      'Re-read the file and provide the full exact text for the intended replacement.',
  };
}

export function fileNotFoundError(path: string): EditError {
  return {
    kind: 'file-not-found',
    message:
      `File not found: ${path}. ` +
      'Check the path, or use write to create the file, then retry the edit.',
  };
}

export function overlappingError(description: string): EditError {
  return {
    kind: 'overlapping',
    message:
      `Overlapping edits: ${description}. ` +
      'Each edits[].oldText must target a disjoint region of the original file. ' +
      'Merge overlapping or adjacent changes into one edit and retry.',
  };
}

export function noOpError(): EditError {
  return {
    kind: 'no-op',
    message:
      'Edit results in no change: the replacement text is identical to the matched text. ' +
      'Change newText to actually modify the content, or drop this edit.',
  };
}

export function validationError(message: string): EditError {
  return { kind: 'validation', message };
}

function abbreviate(text: string, maxLines = 8, maxCols = 80): string {
  const lines = text.split('\n').slice(0, maxLines);
  const abridged = lines.map((l) => (l.length > maxCols ? l.slice(0, maxCols) + '…' : l));
  if (text.split('\n').length > maxLines) abridged.push('…');
  return abridged.join('\n');
}
