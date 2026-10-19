import { describe, expect, it } from 'bun:test';
import {
  blockAnchorFind,
  contextAwareFind,
  escapeNormalizedFind,
  indentationFlexibleFind,
  lineTrimmedFind,
  multiOccurrenceFind,
  simpleFind,
  trimmedBoundaryFind,
  whitespaceNormalizedFind,
} from '../src/domain/passes';

describe('simpleFind', () => {
  it('returns oldContent on contains', () => {
    expect(simpleFind('abc', 'b')).toBe('b');
  });
  it('null on miss', () => {
    expect(simpleFind('abc', 'z')).toBeNull();
  });
  it('empty needle matches (OpenDev parity)', () => {
    expect(simpleFind('abc', '')).toBe('');
  });
});

describe('lineTrimmedFind', () => {
  it('matches trailing-space drift', () => {
    const original = 'a   \nb   \nc   \n';
    const old = 'a\nb\nc';
    expect(lineTrimmedFind(original, old)).toBe('a   \nb   \nc   ');
  });

  it('all-blank query returns null', () => {
    expect(lineTrimmedFind('a\nb', '   \n\t ')).toBeNull();
  });

  it('respects line boundaries (no partial line match)', () => {
    const original = 'ax\nbx';
    expect(lineTrimmedFind(original, 'x')).toBeNull();
  });
});

describe('blockAnchorFind', () => {
  it('requires >= 3 lines', () => {
    expect(blockAnchorFind('a\nb', 'a\nb')).toBeNull();
  });

  it('single candidate → threshold 0.0 (any similarity)', () => {
    const original = 'start\ncompletely\nunrelated\nmiddle\nend';
    const old = 'start\nzzz\nzzz\nzzz\nend';
    expect(blockAnchorFind(original, old)).toBe(original);
  });

  it('multi-candidate below 0.3 threshold → null', () => {
    const original = 'start\nAAAA\nend\nstart\nBBBB\nend';
    const old = 'start\nCCCC\nend';
    expect(blockAnchorFind(original, old)).toBeNull();
  });

  it('returns actual original text, not query', () => {
    const original = 'fn test() {\n    let a = 1;\n    let b = 2;\n    let c = 3;\n}';
    const old = 'fn test() {\n    let a = 10;\n    let b = 20;\n    let c = 30;\n}';
    expect(blockAnchorFind(original, old)).toBe(original);
  });
});

describe('whitespaceNormalizedFind', () => {
  it('collapses whitespace runs per line', () => {
    const original = 'let   x  =   1;';
    expect(whitespaceNormalizedFind(original, 'let x = 1;')).toBe(original);
  });

  it('tolerates line-count drift by +/- window', () => {
    const original = 'a b\nc d\ne f';
    const old = 'a b\nc d\ne f';
    expect(whitespaceNormalizedFind(original, old)).toBe(original);
  });
});

describe('indentationFlexibleFind', () => {
  it('strips indentation and skips blank lines', () => {
    const original = 'fn foo() {\n\n    let x = 1;\n\n    let y = 2;\n}';
    const old = 'let x = 1;\nlet y = 2;';
    expect(indentationFlexibleFind(original, old)).toBe('    let x = 1;\n\n    let y = 2;');
  });

  it('window is 3x query length', () => {
    const original = 'w\n\n\n\n\nx\nlet q = 1;\n\nlet r = 2;';
    const old = 'let q = 1;\nlet r = 2;';
    expect(indentationFlexibleFind(original, old)).toBe('let q = 1;\n\nlet r = 2;');
  });
});

describe('escapeNormalizedFind', () => {
  it('unescapes \\n, \\t, \\\\, \\", \\\'', () => {
    expect(escapeNormalizedFind('a\nb', 'a\\nb')).toBe('a\nb');
    expect(escapeNormalizedFind('a\tb', 'a\\tb')).toBe('a\tb');
    expect(escapeNormalizedFind('a\\b', 'a\\\\b')).toBe('a\\b');
    expect(escapeNormalizedFind('say "hi"', 'say \\"hi\\"')).toBe('say "hi"');
    expect(escapeNormalizedFind("it's", "it\\'s")).toBe("it's");
  });

  it('replaces ALL occurrences (Rust replace parity)', () => {
    const original = 'a\nb\na\nb';
    const old = 'a\\nb\\na\\nb';
    expect(escapeNormalizedFind(original, old)).toBe(original);
  });

  it('no-op when nothing to unescape', () => {
    expect(escapeNormalizedFind('plain text', 'plain text')).toBeNull();
  });
});

describe('trimmedBoundaryFind', () => {
  it('whole-block trim match', () => {
    expect(trimmedBoundaryFind('abc xyz def', '  xyz  ')).toBe('xyz');
  });

  it('line-level boundary expansion', () => {
    const original = 'header\n  alpha\n  beta\nfooter';
    const old = '  \n  alpha\n  beta\n  ';

    expect(trimmedBoundaryFind(original, old)).toBe('alpha\n  beta');
  });

  it('nothing to trim → null (defer to earlier passes)', () => {
    expect(trimmedBoundaryFind('hello world', 'hello world')).toBeNull();
  });
});

describe('contextAwareFind', () => {
  it('requires >= 2 lines', () => {
    expect(contextAwareFind('a\nb', 'a')).toBeNull();
  });

  it('uses first/last non-empty lines as contains-anchors', () => {
    const original =
      'fn setup() {\n    init();\n}\n\nfn main() {\n    let x = compute();\n    println!("{}", x);\n}';
    const old = 'fn main() {\n    let x = calculate();\n    println!("{}", x);\n}';
    const result = contextAwareFind(original, old);
    expect(result).not.toBeNull();
    expect(result).toContain('fn main()');
  });

  it('below 0.5 similarity → null', () => {
    const original = 's\naaaaaa bbbbbb cccccc\ne\ns\ndddddd eeeeee ffffff\ne';
    const old = 's\nXXXXXXXXXX YYYYYYYYYY\ne';
    expect(contextAwareFind(original, old)).toBeNull();
  });

  it('returns actual original text', () => {
    const original = 'a\nb c\nline-x\nd\ne';
    const old = 'b c\nline-x';
    const result = contextAwareFind(original, old);
    expect(result).not.toBeNull();

    expect(original.includes(result!)).toBe(true);
  });
});

describe('multiOccurrenceFind', () => {
  it('trimmed line-by-line equality over exact window', () => {
    const original = '    fn foo() {\n        bar();\n    }';
    const old = '  fn foo() {\n      bar();\n  }';
    expect(multiOccurrenceFind(original, old)).toBe(original);
  });

  it('window length must match exactly (no blank skipping)', () => {
    const original = 'a\n\nb';
    expect(multiOccurrenceFind(original, 'a\nb')).toBeNull();
  });
});

describe('safety invariant: actual is always verbatim in original', () => {
  const passFns = [
    simpleFind,
    lineTrimmedFind,
    blockAnchorFind,
    whitespaceNormalizedFind,
    indentationFlexibleFind,
    escapeNormalizedFind,
    trimmedBoundaryFind,
    contextAwareFind,
    multiOccurrenceFind,
  ];

  it('every pass returns only text present in original', () => {
    const originals = [
      'fn test() {\n    let a = 1;\n    let b = 2;\n    let c = 3;\n}',
      'let   x  =   1;',
      'header\n  alpha\n  beta\nfooter',
      'a\nb\na\nb',
      'start\nmiddle\nend',
    ];
    const queries = [
      'fn test() {\n    let a = 10;\n    let b = 20;\n    let c = 30;\n}',
      'let x = 1;',
      '  \n  alpha\n  beta\n  ',
      'a\\nb\\na\\nb',
      'start\nDIFFERENT\nend',
    ];
    for (const fn of passFns) {
      for (let i = 0; i < originals.length; i++) {
        const actual = fn(originals[i], queries[i]);
        if (actual !== null) {
          expect(originals[i].includes(actual), `${fn.name} returned non-verbatim text`).toBe(true);
        }
      }
    }
  });
});
