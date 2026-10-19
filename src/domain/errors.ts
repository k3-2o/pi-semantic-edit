import { formatLinePositions } from './uniqueness';
import type { ClosestCandidate, EditError } from './types';

export function ambiguousError(path: string, count: number, positions: number[]): EditError {
  return {
    kind: 'ambiguous',
    message:
      `Ambiguous: found ${count} times at ${formatLinePositions(positions)} in ${path}. ` +
      'Add context, or set replaceAll: true.',
    linePositions: positions,
  };
}

export function notFoundError(path: string, closest?: ClosestCandidate): EditError {
  const base = `Text not found in ${path}.`;
  if (!closest) {
    return {
      kind: 'not-found',
      message:
        `${base}\n` + 'Nothing close found. Re-read the file and retry against its current text.',
    };
  }
  const pct = Math.round(closest.similarity * 100);
  const lines =
    closest.startLine === closest.endLine
      ? `line ${closest.startLine}`
      : `lines ${closest.startLine}-${closest.endLine}`;
  const preview = abbreviate(closest.candidate);
  const diffHint =
    closest.lineDiffs && closest.lineDiffs.length > 0
      ? '\nLines that differ:\n' +
        closest.lineDiffs
          .slice(0, 2)
          .map(
            (d) =>
              '  line ' +
              d.lineNumber +
              ': file has ' +
              quoteShort(d.file) +
              '; you wrote ' +
              quoteShort(d.yours),
          )
          .join('\n')
      : '';
  return {
    kind: 'not-found',
    message:
      `${base}\n` +
      `Closest match (${pct}% similar) at ${lines}:\n${preview}${diffHint}\n` +
      'Retry with the exact current text.',
    closestCandidate: closest,
  };
}

function quoteShort(text: string): string {
  const one = text.split('\n')[0];
  const clipped = one.length > 60 ? one.slice(0, 60) + '…' : one;
  return '"' + clipped.replace(/"/g, "'") + '"';
}

export function malformedPatchError(message: string, lineIndex?: number): EditError {
  const at = lineIndex !== undefined ? ` (line ${lineIndex + 1})` : '';
  return {
    kind: 'malformed-patch',
    message: `Malformed patch${at}: ${message}`,
  };
}

export function missingPathError(): EditError {
  return {
    kind: 'missing-path',
    message: 'Missing path: pass a "path" (aider blocks need a path line before SEARCH).',
  };
}

export function disproportionateError(path: string): EditError {
  return {
    kind: 'disproportionate',
    message:
      `Refusing to edit ${path}: matched span is much larger than oldText. ` +
      'Re-read the file and retry with the full exact text.',
  };
}

export function staleReadError(
  path: string,
  changedLines?: [number, number],
  lineExcerpt?: string,
): EditError {
  const where =
    changedLines === undefined
      ? 'the file'
      : changedLines[0] === changedLines[1]
        ? `line ${changedLines[0]}`
        : `lines ${changedLines[0]}-${changedLines[1]}`;
  const now = lineExcerpt ? ` (currently: ${lineExcerpt})` : '';
  return {
    kind: 'stale-read',
    message:
      `Refusing to edit ${path}: ${where} changed since your last read${now}. ` +
      'Your oldText matched the old version; likely concurrent modification. ' +
      'Nothing was written. Re-read the file and retry.',
  };
}

export function fileNotFoundError(path: string): EditError {
  return {
    kind: 'file-not-found',
    message: `File not found: ${path}. Check the path, or use write to create it.`,
  };
}

export function overlappingError(description: string): EditError {
  return {
    kind: 'overlapping',
    message: `Overlapping edits: ${description}. Merge adjacent changes into one edit; oldTexts must stay disjoint.`,
  };
}

export function noOpError(): EditError {
  return {
    kind: 'no-op',
    message: 'No-op: newText is identical to the matched text. Change newText or drop this edit.',
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
