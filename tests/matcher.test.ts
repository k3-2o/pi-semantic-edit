import { describe, expect, it } from 'bun:test';
import { applyEdits, type Edit, type MatcherOptions } from '../src/matcher';

const opts: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
};

function apply(content: string, edits: Edit[], options = opts) {
  return applyEdits(content, edits, options);
}

describe('exact match', () => {
  it('replaces a single occurrence', () => {
    const result = apply('a\nb\nc\n', [{ oldText: 'b', newText: 'x' }]);
    expect(result.failed).toHaveLength(0);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('a\nx\nc\n');
  });

  it('handles multiple edits in one call', () => {
    const result = apply('a\nb\nc\nd\n', [
      { oldText: 'a', newText: 'x' },
      { oldText: 'd', newText: 'y' },
    ]);
    expect(result.failed).toHaveLength(0);
    expect(result.matches).toHaveLength(2);
    expect(result.newContent).toBe('x\nb\nc\ny\n');
  });

  it('rejects empty oldText', () => {
    const result = apply('content', [{ oldText: '', newText: 'x' }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Could not find');
  });

  it('allows replacement that produces the same content', () => {
    const result = apply('a\nb\nc\n', [{ oldText: 'b', newText: 'b' }]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('a\nb\nc\n');
  });
});

describe('whitespace / line-endings', () => {
  it('handles CRLF input by normalizing to LF', () => {
    const result = apply('a\r\nb\r\nc\r\n', [{ oldText: 'b', newText: 'x' }]);
    expect(result.failed).toHaveLength(0);
    expect(result.newContent).toBe('a\nx\nc\n');
  });

  it('exact match is a substring match — trailing whitespace in content is left intact', () => {
    // Content has "b  " but oldText is "b". Exact match finds "b" as a substring, replacing only "b".
    // The trailing spaces remain because they weren't part of oldText.
    const result = apply('a\nb  \nc\n', [{ oldText: 'b', newText: 'x' }]);
    expect(result.failed).toHaveLength(0);
    expect(result.newContent).toBe('a\nx  \nc\n');
  });

  it('normalized match handles trailing whitespace in oldText', () => {
    // oldText "b  " normalized to "b", matches "b" in content
    const result = apply('a\nb\nc\n', [{ oldText: 'b  ', newText: 'x' }]);
    expect(result.failed).toHaveLength(0);
    expect(result.matches[0].usedFuzzy).toBe(true);
    expect(result.newContent).toBe('a\nx\nc\n');
  });
});

describe('duplicate / unique requirement', () => {
  it('disambiguates duplicates with auto-expand', () => {
    const content = 'a\nb\nc\nb\nd\n';
    const result = apply(content, [{ oldText: 'b', newText: 'x' }]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('a\nx\nc\nb\nd\n');
  });

  it('uses anchor to disambiguate', () => {
    const content = 'function a() { x; }\nfunction b() { x; }\n';
    const result = apply(content, [{ anchor: 'function a()', oldText: 'x;', newText: 'y;' }]);
    expect(result.failed).toHaveLength(0);
    expect(result.newContent).toContain('function a() { y; }');
    expect(result.newContent).toContain('function b() { x; }');
  });
});

describe('auto-expand', () => {
  it('expands context to disambiguate duplicates', () => {
    const content = 'a\nb\nc\nb\nd\n';
    const result = apply(content, [{ oldText: 'b', newText: 'x' }]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('a\nx\nc\nb\nd\n');
  });

  it('can disambiguate even identical lines by expanding enough context', () => {
    // 20 identical lines; expansion eventually finds a unique edge region
    const content = Array(20).fill('same line').join('\n');
    const result = apply(content, [{ oldText: 'same line', newText: 'different' }]);
    // With enough expansion, it should find a match (the first or last occurrence
    // gets unique context at the boundary).
    expect(result.matches).toHaveLength(1);
    // The first line should have been replaced
    expect(result.matches[0].start).toBe(0);
  });
});

describe('edge cases', () => {
  it('handles empty file', () => {
    const result = apply('', [{ oldText: 'a', newText: 'x' }]);
    expect(result.failed).toHaveLength(1);
  });

  it('handles unicode quotes', () => {
    const content = "console.log('hello');\n";
    const edit = { oldText: 'console.log(\u2018hello\u2019);', newText: 'console.log("hi");' };
    const result = apply(content, [edit]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].usedFuzzy).toBe(true);
    expect(result.newContent).toBe('console.log("hi");\n');
  });

  it('handles BOM in content', () => {
    const content = '\uFEFFa\nb\nc\n';
    const result = apply(content, [{ oldText: 'a', newText: 'x' }]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('\uFEFFx\nb\nc\n');
  });

  it('detects overlapping edits', () => {
    const result = apply('a\nb\nc\n', [
      { oldText: 'a\nb', newText: 'x' },
      { oldText: 'b\nc', newText: 'y' },
    ]);
    expect(result.matches).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.newContent).toBe('x\nc\n');
  });

  it('reports failure for non-matching text', () => {
    const result = apply('a\nb\nc\n', [{ oldText: 'z', newText: 'x' }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('Could not find');
  });
});
