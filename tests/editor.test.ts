import { describe, expect, it } from 'bun:test';
import { applyBlocks, resolveBlocks } from '../src/domain/editor';
import { parseAiderBlocks } from '../src/domain/parser';

function patch(content: string, path: string, oldText: string, newText: string) {
  return parseAiderBlocks(
    `${path}\n<<<<<<< SEARCH\n${oldText}\n=======\n${newText}\n>>>>>>> REPLACE`,
  );
}

describe('resolveBlocks', () => {
  it('resolves exact matches with unique spans', () => {
    const blocks = patch('x', 'f.ts', 'let a = 1;', 'let a = 2;');
    const outcome = resolveBlocks('let a = 1;\nlet b = 2;', blocks, 'f.ts');
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.resolved![0].start).toBe(0);
    expect(outcome.resolved![0].match.passName).toBe('simple');
  });

  it('returns not-found with closest candidate when nothing matches', () => {
    // first query line has high similarity to an actual line → candidate found
    const blocks = patch('x', 'f.ts', 'const wrong = 42;', 'const right = 1;');
    const outcome = resolveBlocks('const actual = 42;', blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('not-found');
    expect(outcome.error!.closestCandidate).toBeDefined();
    expect(outcome.error!.closestCandidate!.candidate).toContain('const actual = 42;');
  });

  it('not-found without any similar line has no candidate', () => {
    const blocks = patch('x', 'f.ts', 'zzz qqq www', 'replacement');
    const outcome = resolveBlocks('completely different content here', blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('not-found');
    expect(outcome.error!.closestCandidate).toBeUndefined();
  });

  it('returns ambiguous with line positions on duplicate actual text', () => {
    const content = 'function a() {}\n\nfunction b() {}\n\nfunction c() {}';
    // "function" appears 3 times; exact query "function" is ambiguous
    const blocks = patch('x', 'f.ts', 'function', 'fn');
    const outcome = resolveBlocks(content, blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('ambiguous');
    expect(outcome.error!.linePositions).toEqual([1, 3, 5]);
  });

  it('rejects empty SEARCH text', () => {
    const blocks = [{ path: 'f.ts', oldText: '', newText: 'x' }];
    const outcome = resolveBlocks('content', blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('validation');
  });

  it('rejects a disproportionate match (fuzzy pass over-reach)', () => {
    // A 4-line query whose first/last anchor lines match a 8-line span
    // (block_anchor window = oldLines*2 = 8). The matched span (8 lines) is
    // >= oldLines*2 = 8 → disproportionate → refused, never applied.
    const oldText = ['startAnchor();', 'mid 1', 'mid 2', 'endAnchor();'].join('\n');
    const content = [
      'startAnchor();',
      'gap',
      'gap',
      'gap',
      'gap',
      'gap',
      'gap',
      'endAnchor();',
    ].join('\n');
    const outcome = resolveBlocks(content, [{ path: 'f.ts', oldText, newText: 'x' }], 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('disproportionate');
  });

  it("does NOT flag a single-line query as disproportionate (passes can't over-reach)", () => {
    const outcome = resolveBlocks(
      Array.from({ length: 40 }, () => 'same();').join('\n'),
      [{ path: 'f.ts', oldText: 'same();', newText: 'other();' }],
      'f.ts',
    );
    expect(outcome.ok).toBe(false); // ambiguous, NOT disproportionate
    expect(outcome.error!.kind).toBe('ambiguous');
  });

  it('replaceAll resolves EVERY occurrence of the matched text', () => {
    const content = 'a;\nkeep;\na;\na;';
    const outcome = resolveBlocks(
      content,
      [{ path: 'f.ts', oldText: 'a;', newText: 'b;', replaceAll: true }],
      'f.ts',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved).toHaveLength(3);
    // spans point at the ORIGINAL content
    expect(outcome.resolved!.map((r) => content.slice(r.start, r.end))).toEqual(['a;', 'a;', 'a;']);
  });

  it('replaceAll on a unique match still resolves once and reports pass', () => {
    const outcome = resolveBlocks(
      'x = 1;',
      [{ path: 'f.ts', oldText: 'x = 1;', newText: 'x = 2;', replaceAll: true }],
      'f.ts',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.resolved![0].match.passName).toBe('simple');
  });

  it('rejects identical SEARCH and REPLACE', () => {
    const blocks = patch('x', 'f.ts', 'same', 'same');
    const outcome = resolveBlocks('same here', blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('validation');
  });

  it('resolves multiple blocks against the ORIGINAL content', () => {
    const blocks = parseAiderBlocks(
      'f.ts\n<<<<<<< SEARCH\nfirst\n=======\nFIRST\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nsecond\n=======\nSECOND\n>>>>>>> REPLACE',
    );
    const outcome = resolveBlocks('first\nsecond\nthird', blocks, 'f.ts');
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved).toHaveLength(2);
    // second block resolves against original (index 6), not shifted content
    expect(outcome.resolved![1].start).toBe(6);
  });
});

describe('applyBlocks', () => {
  it('applies all blocks and reports match passes', () => {
    const blocks = parseAiderBlocks(
      'f.ts\n<<<<<<< SEARCH\nlet x = 1;\n=======\nlet x = 2;\n>>>>>>> REPLACE',
    );
    const result = applyBlocks('let x = 1;', blocks, 'f.ts');
    expect(result.ok).toBe(true);
    expect(result.content).toBe('let x = 2;');
    expect(result.matchPasses).toEqual(['simple']);
  });

  it('reports non-simple pass in matchPasses', () => {
    // content has collapsed spacing; query uses single spaces → drift
    const blocks = patch('x', 'f.ts', 'let x = 1;', 'let x = 2;');
    const result = applyBlocks('let   x  =   1;', blocks, 'f.ts');
    expect(result.ok).toBe(true);
    expect(result.matchPasses[0]).toBe('whitespace_normalized');
  });

  it('fails on overlapping edits', () => {
    const blocks = parseAiderBlocks(
      'f.ts\n<<<<<<< SEARCH\nabc\n=======\nX\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nbcd\n=======\nY\n>>>>>>> REPLACE',
    );
    const result = applyBlocks('abcde', blocks, 'f.ts');
    expect(result.ok).toBe(false);
    expect(result.error!.kind).toBe('overlapping');
  });

  it('fails on no-op edits', () => {
    const blocks = patch('x', 'f.ts', 'same', 'same');
    // identical old/new caught at resolve; a whitespace-only drift that
    // normalizes to the same text is caught at apply
    const blocks2 = parseAiderBlocks(
      'f.ts\n<<<<<<< SEARCH\nlet  x = 1;\n=======\nlet x = 1;\n>>>>>>> REPLACE',
    );
    const result = applyBlocks('let x = 1;', blocks2, 'f.ts');
    expect(result.ok).toBe(false);
    expect(result.error!.kind).toBe('no-op');
    void blocks;
  });

  it('applyBlocks replaceAll replaces all occurrences and counts replacements', () => {
    const result = applyBlocks(
      'const a = 1;\nconst b = a + a;\n',
      [{ path: 'f.ts', oldText: 'a', newText: 'item', replaceAll: true }],
      'f.ts',
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe('const item = 1;\nconst b = item + item;\n');
    expect(result.replacements).toBe(3);
    // per-span pass names: 3 spans from one replaceAll edit
    expect(result.matchPasses).toEqual(['replace_all', 'replace_all', 'replace_all']);
  });
});
