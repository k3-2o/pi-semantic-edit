import { describe, expect, it } from 'bun:test';
import {
  changedLineRange,
  checkStaleGuard,
  crossesWordBoundary,
  evaluateStaleness,
  ReadTracker,
  type FileSnapshot,
} from '../src/pi/staleness';

const snapshot = (content: string, size = content.length): FileSnapshot => ({
  content,
  size,
  mtimeMs: 1000,
});

describe('evaluateStaleness', () => {
  it('never refuses formatting-class passes, even with a stale snapshot', () => {
    for (const pass of [
      'line_trimmed',
      'whitespace_normalized',
      'indentation_flexible',
      'escape_normalized',
      'trimmed_boundary',
      'multi_occurrence',
      'unicode_normalized',
      'auto_expand',
      'replace_all',
    ]) {
      expect(
        evaluateStaleness({
          passName: pass,
          crossesBoundary: true,
          snapshot: snapshot('old'),
          currentContent: 'new',
        }).stale,
      ).toBe(false);
    }
  });

  it('never refuses a clean boundary simple pass, even with a stale snapshot', () => {
    expect(
      evaluateStaleness({
        passName: 'simple',
        crossesBoundary: false,
        snapshot: snapshot('old'),
        currentContent: 'new',
      }).stale,
    ).toBe(false);
  });

  it('refuses a content-absorbing pass when the file changed since the last read', () => {
    const v = evaluateStaleness({
      passName: 'block_anchor',
      crossesBoundary: false,
      snapshot: snapshot('function b() {\n  return 2;\n}\n'),
      currentContent: 'function b() {\n  return 2; // drifted\n}\n',
    });
    expect(v.stale).toBe(true);
    expect(v.changedLines).toEqual([2, 2]);
  });

  it('allows a content-absorbing pass when the snapshot is fresh (model saw this version)', () => {
    expect(
      evaluateStaleness({
        passName: 'context_aware',
        crossesBoundary: false,
        snapshot: snapshot('aaa\nbbb\nccc\n'),
        currentContent: 'aaa\nbbb\nccc\n',
      }).stale,
    ).toBe(false);
  });

  it('allows a content-absorbing pass when there is no snapshot (edited blind)', () => {
    expect(
      evaluateStaleness({
        passName: 'block_anchor',
        crossesBoundary: false,
        snapshot: undefined,
        currentContent: 'whatever\n',
      }).stale,
    ).toBe(false);
  });

  it('refuses a simple match that crosses a word boundary when the file changed', () => {
    const v = evaluateStaleness({
      passName: 'simple',
      crossesBoundary: true,
      snapshot: snapshot('aaa\nbbb\nccc\n'),
      currentContent: 'aaa\nbbb-x\nccc\n',
    });
    expect(v.stale).toBe(true);
  });

  it('allows a simple match on a clean token even when the file changed', () => {
    expect(
      evaluateStaleness({
        passName: 'simple',
        crossesBoundary: false,
        snapshot: snapshot('aaa\nbbb\nccc\n'),
        currentContent: 'aaa\nbbb\nccc-x\n',
      }).stale,
    ).toBe(false);
  });

  it('allows simple matches that cross a boundary when the file is unchanged', () => {
    expect(
      evaluateStaleness({
        passName: 'simple',
        crossesBoundary: true,
        snapshot: snapshot('user_id\n'),
        currentContent: 'user_id\n',
      }).stale,
    ).toBe(false);
  });

  it('falls back to fingerprints for large files (no content snapshot)', () => {
    const big: FileSnapshot = { content: null, size: 500_000, mtimeMs: 1000 };
    expect(
      evaluateStaleness({
        passName: 'block_anchor',
        crossesBoundary: false,
        snapshot: big,
        currentContent: '',
        currentSize: 500_000,
        currentMtimeMs: 1000,
      }).stale,
    ).toBe(false);
    expect(
      evaluateStaleness({
        passName: 'block_anchor',
        crossesBoundary: false,
        snapshot: big,
        currentContent: '',
        currentSize: 500_001,
        currentMtimeMs: 1000,
      }).stale,
    ).toBe(true);
  });

  it('treats unknown pass names as evidence-required (safe default)', () => {
    expect(
      evaluateStaleness({
        passName: 'mystery_pass',
        crossesBoundary: false,
        snapshot: snapshot('a'),
        currentContent: 'b',
      }).stale,
    ).toBe(true);
  });
});

describe('crossesWordBoundary', () => {
  it('detects a simple match glued inside a longer token', () => {
    const content = 'aaa\nbbb-x\nccc\n';
    const at = content.indexOf('bbb');
    expect(crossesWordBoundary(content, at, at + 3)).toBe(true);
  });

  it('does not flag a standalone token line', () => {
    const content = 'aaa\nbbb\nccc\n';
    const at = content.indexOf('bbb');
    expect(crossesWordBoundary(content, at, at + 3)).toBe(false);
  });

  it('flags mid-word and prefix matches (user inside user_id, foo inside foo.json)', () => {
    const content = 'const user_id = foo.json;\n';
    const at = content.indexOf('user');
    expect(crossesWordBoundary(content, at, at + 4)).toBe(true);
    const at2 = content.indexOf('foo');
    expect(crossesWordBoundary(content, at2, at2 + 3)).toBe(true);
  });
});

describe('changedLineRange', () => {
  it('reports the drifted line 1-indexed', () => {
    expect(changedLineRange('aaa\nbbb\nccc\n', 'aaa\nbbb-x\nccc\n')).toEqual([2, 2]);
  });

  it('reports a multi-line middle change', () => {
    expect(changedLineRange('a\nb\nc\nd\ne\n', 'a\nB\nC\nd\ne\n')).toEqual([2, 3]);
  });

  it('reports appended lines', () => {
    expect(changedLineRange('aaa\n', 'aaa\nbbb\n')).toEqual([2, 2]);
  });

  it('handles a deleted line', () => {
    expect(changedLineRange('a\nb\nc\n', 'a\nc\n')).toEqual([2, 2]);
  });
});

describe('ReadTracker + checkStaleGuard', () => {
  it('checkStaleGuard refuses the whole call when any edit is stale', () => {
    const tracker = new ReadTracker();
    tracker.record('/x.ts', snapshot('aaa\nbbb\nccc\n'));
    const v = checkStaleGuard({
      tracker,
      path: '/x.ts',
      matchPasses: ['simple', 'block_anchor'],
      spans: [
        { start: 0, end: 3 },
        { start: 0, end: 3 },
      ],
      currentContent: 'aaa-x\nbbb\nccc\n',
    });
    expect(v.stale).toBe(true);
  });

  it('checkStaleGuard allows when no edit needs evidence', () => {
    const tracker = new ReadTracker();
    tracker.record('/x.ts', snapshot('aaa\nbbb\nccc\n'));
    const v = checkStaleGuard({
      tracker,
      path: '/x.ts',
      matchPasses: ['line_trimmed', 'unicode_normalized'],
      spans: [
        { start: 0, end: 3 },
        { start: 0, end: 3 },
      ],
      currentContent: 'aaa-x\nbbb\nccc\n',
    });
    expect(v.stale).toBe(false);
  });

  it('tracker records, overwrites, and returns what was seen', () => {
    const tracker = new ReadTracker();
    expect(tracker.get('/a')).toBeUndefined();
    tracker.record('/a', snapshot('one'));
    tracker.record('/a', snapshot('two'));
    expect(tracker.get('/a')?.content).toBe('two');
  });

  it('boundary is derived from the current file span, not the pass name', () => {
    const tracker = new ReadTracker();
    tracker.record('/b.ts', snapshot('aaa\nbbb\nccc\n'));
    const content = 'aaa\nbbb-x\nccc\n';
    const at = content.indexOf('bbb');
    const v = checkStaleGuard({
      tracker,
      path: '/b.ts',
      matchPasses: ['simple'],
      spans: [{ start: at, end: at + 3 }],
      currentContent: content,
    });
    expect(v.stale).toBe(true);
  });
});

describe('checkStaleGuard span overlap', () => {
  it('refuses only when the changed lines overlap the matched span', () => {
    const tracker = new ReadTracker();
    tracker.record('/x.ts', snapshot('aaa\nbbb\nccc\n'));
    const content = 'AAA\nbbb\nccc\n';
    const span = { start: content.indexOf('bbb'), end: content.indexOf('bbb') + 3 };
    const far = checkStaleGuard({
      tracker,
      path: '/x.ts',
      matchPasses: ['block_anchor'],
      spans: [span],
      currentContent: content,
    });
    // change at line 1, span at line 2 -> no overlap -> allowed
    expect(far.stale).toBe(false);
  });

  it('refuses when the change is inside the matched span', () => {
    const tracker = new ReadTracker();
    tracker.record('/x.ts', snapshot('aaa\nbbb\nccc\n'));
    const content = 'aaa\nbbb-X\nccc\n';
    const span = { start: content.indexOf('bbb'), end: content.indexOf('bbb') + 5 };
    const v = checkStaleGuard({
      tracker,
      path: '/x.ts',
      matchPasses: ['block_anchor'],
      spans: [span],
      currentContent: content,
    });
    expect(v.stale).toBe(true);
    expect(v.changedLines).toEqual([2, 2]);
  });
});
