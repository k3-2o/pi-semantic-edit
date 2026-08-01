import { describe, expect, it } from 'bun:test';
import { similarity } from '../src/domain/similarity';

describe('similarity (LCS ratio)', () => {
  it('identical strings → 1.0', () => {
    expect(similarity('hello', 'hello')).toBe(1.0);
    expect(similarity('', '')).toBe(1.0);
  });

  it('empty vs non-empty → 0.0', () => {
    expect(similarity('', 'abc')).toBe(0.0);
    expect(similarity('abc', '')).toBe(0.0);
  });

  it('no common characters → 0.0', () => {
    expect(similarity('abc', 'xyz')).toBe(0.0);
  });

  it('partial overlap is between 0 and 1', () => {
    expect(similarity('abcdef', 'abcxyz')).toBeGreaterThan(0.0);
    expect(similarity('abcdef', 'abcxyz')).toBeLessThan(1.0);
  });

  it('shared subsequence counts (not substring)', () => {
    // "ace" is a common subsequence of "abcde" and "ace": 2*3/(5+3)=0.75
    expect(similarity('abcde', 'ace')).toBeCloseTo(0.75, 5);
  });

  it('block-anchor threshold scale: near-identical middles score high', () => {
    // The block-anchor pass uses > 0.3 for multi-candidate matches.
    const high = similarity(
      'let a = 1;\nlet b = 2;\nlet c = 3;',
      'let a = 10;\nlet b = 20;\nlet c = 30;',
    );
    expect(high).toBeGreaterThan(0.3);
  });

  it('unrelated code scores below 0.3', () => {
    const low = similarity('let a = 1;\nlet b = 2;', 'xxxxx yyyyy');
    expect(low).toBeLessThan(0.3);
  });

  it('symmetric', () => {
    expect(similarity('abc', 'ab')).toBe(similarity('ab', 'abc'));
  });
});
