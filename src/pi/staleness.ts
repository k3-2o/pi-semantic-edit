import { normalizeNewlines, stripBom } from '../domain/utils';

export const MAX_SNAPSHOT_CHARS = 250_000;

export interface FileSnapshot {
  content: string | null;
  size: number;
  mtimeMs: number;
}

const FORMATTING_PASSES = new Set([
  'simple',
  'line_trimmed',
  'whitespace_normalized',
  'indentation_flexible',
  'escape_normalized',
  'trimmed_boundary',
  'multi_occurrence',
  'unicode_normalized',
  'auto_expand',
  'replace_all',
]);

export function isContentAbsorbingPass(passName: string): boolean {
  return !FORMATTING_PASSES.has(passName);
}

const WORD_CHAR = /[A-Za-z0-9_\-.'\u00C0-\uFFFF]/;

export function crossesWordBoundary(content: string, start: number, end: number): boolean {
  const left = start > 0 && WORD_CHAR.test(content[start - 1]);
  const right = end < content.length && WORD_CHAR.test(content[end]);
  return left || right;
}

export function normalizeSnapshot(text: string): string {
  return normalizeNewlines(stripBom(text).text);
}

export class ReadTracker {
  private static readonly MAX_ENTRIES = 256;
  private known = new Map<string, FileSnapshot>();

  record(path: string, snapshot: FileSnapshot): void {
    this.known.set(path, snapshot);
    if (this.known.size > ReadTracker.MAX_ENTRIES) {
      const oldest = this.known.keys().next().value;
      if (oldest !== undefined) this.known.delete(oldest);
    }
  }

  get(path: string): FileSnapshot | undefined {
    return this.known.get(path);
  }
}

export interface StalenessVerdict {
  stale: boolean;

  changedLines?: [number, number];
}

export function evaluateStaleness(opts: {
  passName: string;
  crossesBoundary: boolean;
  snapshot: FileSnapshot | undefined;
  currentContent: string;
  currentSize?: number;
  currentMtimeMs?: number;
}): StalenessVerdict {
  const { passName, crossesBoundary, snapshot } = opts;

  const needsEvidence =
    isContentAbsorbingPass(passName) || (passName === 'simple' && crossesBoundary);
  if (!needsEvidence) return { stale: false };

  if (!snapshot) return { stale: false };

  if (snapshot.content !== null) {
    if (snapshot.content === opts.currentContent) return { stale: false };
    return { stale: true, changedLines: changedLineRange(snapshot.content, opts.currentContent) };
  }

  if (opts.currentMtimeMs === snapshot.mtimeMs && opts.currentSize === snapshot.size) {
    return { stale: false };
  }
  return { stale: true };
}

export function checkStaleGuard(opts: {
  tracker: ReadTracker;
  path: string;
  matchPasses: string[];
  spans: { start: number; end: number }[];
  currentContent: string;
  currentSize?: number;
  currentMtimeMs?: number;
}): StalenessVerdict {
  const best: StalenessVerdict = { stale: false };
  for (let i = 0; i < opts.matchPasses.length; i++) {
    const span = opts.spans[i];
    const boundary = span ? crossesWordBoundary(opts.currentContent, span.start, span.end) : false;
    const v = evaluateStaleness({
      passName: opts.matchPasses[i],
      crossesBoundary: boundary,
      snapshot: opts.tracker.get(opts.path),
      currentContent: opts.currentContent,
      currentSize: opts.currentSize ?? 0,
      currentMtimeMs: opts.currentMtimeMs ?? 0,
    });
    if (v.stale && span && v.changedLines) {
      const spanRange = spanLineRange(opts.currentContent, span.start, span.end);
      const [c1, c2] = v.changedLines;
      if (spanRange[1] < c1 || spanRange[0] > c2) continue;
    }
    if (v.stale) return v;
  }
  return best;
}

function spanLineRange(content: string, start: number, end: number): [number, number] {
  const before = content.slice(0, start).split('\n').length;
  const through = content.slice(0, end).split('\n').length;
  return [before, Math.max(before, through)];
}

export function changedLineRange(oldText: string, newText: string): [number, number] {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const first = Math.min(prefix + 1, Math.max(1, b.length));
  const last = Math.max(first, b.length - suffix);
  return [first, last];
}
