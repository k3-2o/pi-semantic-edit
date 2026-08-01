import { describe, expect, it } from 'bun:test';
import { applyEdits } from '../src/domain/apply';
import { findMatch } from '../src/domain/chain';
import { reportOccurrences, formatLinePositions } from '../src/domain/uniqueness';
import type { ResolvedEdit } from '../src/domain/types';

/** Helper: match an edit against content and resolve its unique span. */
function resolve(content: string, path: string, oldText: string, newText: string): ResolvedEdit {
  const match = findMatch(content, oldText);
  if (!match) throw new Error(`no match for: ${oldText}`);
  const start = content.indexOf(match.actual);
  if (start === -1) throw new Error('invariant: actual not in content');
  return { edit: { path, oldText, newText }, match, start, end: start + match.actual.length };
}

describe('uniqueness', () => {
  it('flags ambiguity on the actual matched text', () => {
    const content = 'a\nfoo\nb\nfoo\nc';
    const match = findMatch(content, 'foo')!;
    expect(match.actual).toBe('foo');
    const report = reportOccurrences(content, match.actual);
    expect(report.count).toBe(2);
    expect(report.ambiguous).toBe(true);
    expect(report.positions).toEqual([2, 4]);
  });

  it('single occurrence is unambiguous', () => {
    const report = reportOccurrences('a\nfoo\nb', 'foo');
    expect(report.ambiguous).toBe(false);
    expect(report.positions).toEqual([2]);
  });

  it('formatLinePositions renders 1-indexed lines', () => {
    expect(formatLinePositions([3, 7, 12])).toBe('line 3, line 7, line 12');
  });

  it('multiline actual counts whole-block occurrences', () => {
    const content = 'start\nlet x = 1;\nend\nstart\nlet x = 1;\nend';
    const match = findMatch(content, 'start\nlet x = 1;\nend')!;
    expect(reportOccurrences(content, match.actual).count).toBe(2);
  });
});

describe('applyEdits', () => {
  it('applies a single edit', () => {
    const content = 'let x = 1;';
    const edits = [resolve(content, 'f.ts', 'let x = 1;', 'let x = 2;')];
    const result = applyEdits(content, edits);
    expect(result.failed).toEqual([]);
    expect(result.content).toBe('let x = 2;');
    expect(result.applied).toHaveLength(1);
  });

  it('applies multiple edits bottom-up on original content', () => {
    const content = 'a\nbb\nc';
    const e1 = resolve(content, 'f.ts', 'a', 'A');
    const e2 = resolve(content, 'f.ts', 'bb', 'BB');
    // e1 is at index 0, e2 at index 2 — bottom-up applies e2 first
    const result = applyEdits(content, [e1, e2]);
    expect(result.failed).toEqual([]);
    expect(result.content).toBe('A\nBB\nc');
  });

  it('detects overlapping edits', () => {
    const content = 'abcde';
    // "abc" spans 0..3, "bcd" spans 1..4 — overlap
    const e1 = resolve(content, 'f.ts', 'abc', 'X');
    const e2 = resolve(content, 'f.ts', 'bcd', 'Y');
    const result = applyEdits(content, [e1, e2]);
    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('overlap');
    expect(result.content).toBe(content); // untouched
  });

  it('rejects no-op edits (old == new)', () => {
    const content = 'let x = 1;';
    const edits = [resolve(content, 'f.ts', 'let x = 1;', 'let x = 1;')];
    const result = applyEdits(content, edits);
    expect(result.applied).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.content).toBe(content);
  });

  it('multi-line replacement preserves untouched regions', () => {
    const content = 'line1\nold line\nold line 2\nline4';
    const edits = [resolve(content, 'f.ts', 'old line\nold line 2', 'new line\nnew line 2')];
    const result = applyEdits(content, edits);
    expect(result.content).toBe('line1\nnew line\nnew line 2\nline4');
  });
});
