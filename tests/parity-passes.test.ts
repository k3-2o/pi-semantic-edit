// PARITY SUITE — every test case from OpenDev's edit_replacers/tests.rs
// (Rust), translated to bun:test against our TypeScript port. These are the
// proof that the port matches the reference implementation's semantics.
// Source: .vscode/research/opendev-source/tests.rs
//
// Omitted by design: unified_diff tests (we render diffs via Pi's
// generateDiffString — see SPEC D6).

import { describe, expect, it } from 'bun:test';
import { findMatch, findOccurrencePositions } from '../src/domain/chain';
import { similarity } from '../src/domain/similarity';
import { normalizeNewlines } from '../src/domain/utils';

describe('parity: simple', () => {
  it('exact match', () => {
    const original = 'fn main() {\n    println!("hello");\n}';
    const old = 'println!("hello");';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('simple');
    expect(result!.actual).toBe(old);
  });

  it('no match', () => {
    const original = 'fn main() {}';
    expect(findMatch(original, 'nonexistent')).toBeNull();
  });
});

describe('parity: line_trimmed', () => {
  it('extra indentation in original', () => {
    const original = 'fn foo() {\n    let x = 1;\n    let y = 2;\n}';
    const old = 'let x = 1;\nlet y = 2;';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('line_trimmed');
    expect(result!.actual).toBe('    let x = 1;\n    let y = 2;');
  });

  it('different indent levels', () => {
    const original = '  if true {\n      do_thing();\n  }';
    const old = 'if true {\n    do_thing();\n}';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('line_trimmed');
    expect(result!.actual).toBe('  if true {\n      do_thing();\n  }');
  });
});

describe('parity: block_anchor', () => {
  it('middle differs', () => {
    const original = 'fn test() {\n    let a = 1;\n    let b = 2;\n    let c = 3;\n}';
    const old = 'fn test() {\n    let a = 10;\n    let b = 20;\n    let c = 30;\n}';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('block_anchor');
    expect(result!.actual.startsWith('fn test()')).toBe(true);
    expect(result!.actual.endsWith('}')).toBe(true);
  });

  it('too few lines falls back to simple', () => {
    const original = 'fn test() {\n}';
    const old = 'fn test() {\n}';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('simple');
  });
});

describe('parity: whitespace_normalized', () => {
  it('collapsed single line', () => {
    const original = 'let   x  =   1;';
    const old = 'let x = 1;';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('whitespace_normalized');
    expect(result!.actual).toBe('let   x  =   1;');
  });

  it('multiline', () => {
    const original = 'fn foo() {\n    let   x  =  1;\n    let  y =  2;\n}';
    const old = 'let x = 1;\nlet y = 2;';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(['line_trimmed', 'whitespace_normalized']).toContain(result!.passName);
  });
});

describe('parity: indentation_flexible', () => {
  it('skips blank lines', () => {
    const original = 'fn foo() {\n\n    let x = 1;\n\n    let y = 2;\n}';
    const old = 'let x = 1;\nlet y = 2;';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(['line_trimmed', 'indentation_flexible']).toContain(result!.passName);
  });
});

describe('parity: escape_normalized', () => {
  it('literal \\n instead of newline', () => {
    const original = 'let s = "hello\nworld";';
    const old = 'let s = "hello\\nworld";';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('escape_normalized');
    expect(result!.actual).toBe('let s = "hello\nworld";');
  });

  it('literal \\t instead of tab', () => {
    const original = 'let s = "hello\tworld";';
    const old = 'let s = "hello\\tworld";';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('escape_normalized');
  });

  it('no escapes → simple pass', () => {
    const original = 'hello world';
    const old = 'hello world';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('simple');
  });
});

describe('parity: trimmed_boundary', () => {
  it('boundary trim with line expansion', () => {
    const original = 'header\n  alpha_line\n  beta_line\nfooter';
    const old = '  \n  alpha_line\n  beta_line\n  ';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.actual).toContain('alpha_line');
    expect(result!.actual).toContain('beta_line');
  });

  it('no trim needed → simple', () => {
    const original = 'hello world';
    const old = 'hello world';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('simple');
  });
});

describe('parity: context_aware', () => {
  it('anchors match, middle differs', () => {
    const original =
      'fn setup() {\n    init();\n}\n\nfn main() {\n    let x = compute();\n    println!("{}", x);\n}';
    const old = 'fn main() {\n    let x = calculate();\n    println!("{}", x);\n}';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(['block_anchor', 'context_aware']).toContain(result!.passName);
    expect(result!.actual).toContain('fn main()');
  });
});

describe('parity: multi_occurrence', () => {
  it('trimmed line-by-line match', () => {
    const original = '    fn foo() {\n        bar();\n    }';
    const old = '  fn foo() {\n      bar();\n  }';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(['line_trimmed', 'multi_occurrence']).toContain(result!.passName);
    expect(result!.actual).toBe('    fn foo() {\n        bar();\n    }');
  });
});

describe('parity: similarity', () => {
  it('identical', () => {
    expect(Math.abs(similarity('hello', 'hello') - 1.0)).toBeLessThan(Number.EPSILON);
  });
  it('empty', () => {
    expect(Math.abs(similarity('', '') - 1.0)).toBeLessThan(Number.EPSILON);
    expect(Math.abs(similarity('hello', '') - 0.0)).toBeLessThan(Number.EPSILON);
  });
  it('partial', () => {
    const sim = similarity('abcdef', 'abcxyz');
    expect(sim).toBeGreaterThan(0.0);
    expect(sim).toBeLessThan(1.0);
  });
});

describe('parity: line endings', () => {
  it('normalize_line_endings', () => {
    expect(normalizeNewlines('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('find_match with CRLF', () => {
    const original = 'line1\r\nline2\r\nline3';
    const old = 'line2';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('simple');
    expect(result!.actual).toBe('line2');
  });
});

describe('parity: edge cases', () => {
  it('empty old content matches via simple', () => {
    const original = 'hello world';
    const result = findMatch(original, '');
    expect(result).not.toBeNull();
  });

  it('multiline exact', () => {
    const original = 'fn main() {\n    let x = 1;\n    let y = 2;\n    println!("{} {}", x, y);\n}';
    const old = '    let x = 1;\n    let y = 2;';
    const result = findMatch(original, old);
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('simple');
    expect(result!.actual).toBe(old);
  });
});

describe('parity: find_occurrence_positions', () => {
  it('line numbers', () => {
    const content = 'foo\nbar\nfoo\nbaz\nfoo';
    expect(findOccurrencePositions(content, 'foo')).toEqual([1, 3, 5]);
  });
  it('needle at end', () => {
    expect(findOccurrencePositions('abc', 'c')).toEqual([1]);
  });
  it('needle is entire string', () => {
    expect(findOccurrencePositions('abc', 'abc')).toEqual([1]);
  });
  it('multibyte utf8 (no panic, line counting)', () => {
    // 🌍 is 4 bytes in UTF-8; JS indexes by code units — must not break.
    expect(findOccurrencePositions('a🌍b🌍c', '🌍')).toEqual([1, 1]);
  });
  it('empty needle does not panic and finds something', () => {
    expect(findOccurrencePositions('abc', '').length).toBeGreaterThan(0);
  });
  it('no match', () => {
    expect(findOccurrencePositions('abc', 'xyz')).toEqual([]);
  });
});
