import { describe, expect, it } from 'bun:test';
import { findMatch, findOccurrencePositions } from '../src/domain/chain';
import { REPLACER_CHAIN } from '../src/domain/passes';

describe('REPLACER_CHAIN', () => {
  it('has 10 passes: 9 OpenDev in order, then our unicode pass', () => {
    expect(REPLACER_CHAIN.map((p) => p.name)).toEqual([
      'simple',
      'line_trimmed',
      'block_anchor',
      'whitespace_normalized',
      'indentation_flexible',
      'escape_normalized',
      'trimmed_boundary',
      'context_aware',
      'multi_occurrence',
      'unicode_normalized',
    ]);
  });
});

describe('findMatch chain behavior', () => {
  it('short-circuits: exact match costs the simple pass only', () => {
    const result = findMatch('fn main() {\n    println!("hi");\n}', 'println!("hi");');
    expect(result!.passName).toBe('simple');
  });

  it('progresses to later passes only when earlier ones fail', () => {
    // indentation drift: line_trimmed catches it before block_anchor
    const original = 'fn foo() {\n    let x = 1;\n    let y = 2;\n}';
    const result = findMatch(original, 'let x = 1;\nlet y = 2;');
    expect(result!.passName).toBe('line_trimmed');
  });

  it('normalizes line endings before matching', () => {
    const result = findMatch('a\r\nb\r\nc', 'a\nb');
    expect(result).not.toBeNull();
    expect(result!.actual).toBe('a\nb');
  });

  it('unicode pass catches single-line curly-quote drift (pass 10)', () => {
    // The smoke-test #9 single-line case: passes 1-9 all fail, unicode catches it
    const original = 'const config = {\n  name: "demo",\n  retries: 3,\n};';
    const result = findMatch(original, '  name: \u201cdemo\u201d,');
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('unicode_normalized');
    expect(result!.actual).toBe('  name: "demo",'); // verbatim original returned
  });

  it('returns null when nothing matches', () => {
    expect(findMatch('totally different content', 'something else entirely')).toBeNull();
  });

  it('later passes resolve drift earlier passes reject', () => {
    // escape drift: passes 1-5 fail, pass 6 catches it
    const original = 'let s = "hello\nworld";';
    const result = findMatch(original, 'let s = "hello\\nworld";');
    expect(result!.passName).toBe('escape_normalized');
  });

  it('multi_occurrence is defense-in-depth (rarely reachable by design)', () => {
    // Empirically, earlier passes (line_trimmed, indentation_flexible) resolve
    // everything multi_occurrence would — it stays registered as the final
    // guard. Its semantics are pinned directly in passes.test.ts.
    const original = '    x\n        y\n    ';
    const result = findMatch(original, '\nx\n  y\n');
    expect(result).not.toBeNull();
    expect(['line_trimmed', 'indentation_flexible']).toContain(result!.passName);
  });
});

describe('findOccurrencePositions', () => {
  it('counts occurrences across lines', () => {
    expect(findOccurrencePositions('a\nb\na\nc\na', 'a')).toEqual([1, 3, 5]);
  });

  it('multiline needle on one line', () => {
    expect(findOccurrencePositions('aa', 'aa')).toEqual([1]);
  });

  it('needle spanning lines', () => {
    const content = 'x\nfoo\nbar\ny';
    expect(findOccurrencePositions(content, 'foo\nbar')).toEqual([2]);
  });

  it('needle at end of content', () => {
    expect(findOccurrencePositions('abc', 'c')).toEqual([1]);
    expect(findOccurrencePositions('abc\nc', 'c')).toEqual([1, 2]);
  });
});
