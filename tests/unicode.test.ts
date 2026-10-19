import { describe, expect, it } from 'bun:test';
import { findMatch } from '../src/domain/chain';
import { unicodeNormalizedFind } from '../src/domain/passes';

describe('unicodeNormalizedFind (NFKC, pass 10)', () => {
  it('catches curly quotes → straight quotes', () => {
    expect(unicodeNormalizedFind('name: "demo",', 'name: \u201cdemo\u201d,')).toBe('name: "demo",');
  });

  it('catches non-breaking space → space', () => {
    expect(unicodeNormalizedFind('a b', 'a\u00a0b')).toBe('a b');
  });

  it('catches em-dash and en-dash → hyphen', () => {
    expect(unicodeNormalizedFind('foo - bar', 'foo \u2014 bar')).toBe('foo - bar');
    expect(unicodeNormalizedFind('foo - bar', 'foo \u2013 bar')).toBe('foo - bar');
  });

  it('catches ligatures', () => {
    expect(unicodeNormalizedFind('conﬁg', 'config')).toBe('conﬁg');
  });

  it('skips when nothing to normalize (parity)', () => {
    expect(unicodeNormalizedFind('plain text', 'plain text')).toBeNull();
  });

  it('returns null when the normalized text is not present', () => {
    expect(unicodeNormalizedFind('zzz', '\u201cquote\u201d')).toBeNull();
  });

  it('handles multiline blocks', () => {
    const original = 'const config = {\n  name: "demo",\n};';
    const old = 'const config = {\n  name: \u201cdemo\u201d,\n};';
    expect(unicodeNormalizedFind(original, old)).toBe(original);
  });
});

describe('findMatch: unicode as the final pass', () => {
  it('single-line curly-quote SEARCH resolves via unicode_normalized', () => {
    const original = 'const config = {\n  name: "demo",\n  retries: 3,\n};';
    const result = findMatch(original, '  name: \u201cdemo\u201d,');
    expect(result).not.toBeNull();
    expect(result!.passName).toBe('unicode_normalized');
  });

  it('all 9 OpenDev passes still take precedence for their own cases', () => {
    const result = findMatch('let   x  =   1;', 'let x = 1;');
    expect(result!.passName).toBe('whitespace_normalized');
  });

  it('plain single-line drift is still a miss when unicode does not help', () => {
    expect(findMatch('abc def', 'xyz qrs')).toBeNull();
  });
});

import { resolveBlocks } from '../src/domain/editor';

describe('unicodeNormalizedFind: confusable homoglyphs (pass 10)', () => {
  it('catches Cyrillic а in the file when the model wrote latin a', () => {
    expect(unicodeNormalizedFind('d\u0430t\u0430', 'data')).toBe('d\u0430t\u0430');
  });

  it('catches latin a in the file when the model wrote Cyrillic а', () => {
    expect(unicodeNormalizedFind('data', 'd\u0430t\u0430')).toBe('data');
  });

  it('recovers a full line containing a homoglyph', () => {
    const original = 'function start() {\n  return d\u0430t\u0430;\n}';
    expect(unicodeNormalizedFind(original, '  return data;')).toBe('  return d\u0430t\u0430;');
  });

  it('catches Cyrillic т е с р and Greek omicron', () => {
    expect(unicodeNormalizedFind('\u0442\u0435\u0441\u0442 \u03BF\u0440\u0430', 'tect opa')).toBe(
      '\u0442\u0435\u0441\u0442 \u03BF\u0440\u0430',
    );
  });

  it('does not match unmapped confusables (no over-tolerance)', () => {
    expect(unicodeNormalizedFind('star', '\u0436tar')).toBeNull();
  });

  it('simple still wins when the exact text exists anywhere', () => {
    const original = 'data\nd\u0430t\u0430\n';
    expect(findMatch(original, 'data')!.passName).toBe('simple');
  });

  it('resolves Cyrillic oldText via unicode_normalized in the full chain', () => {
    const result = findMatch('data', 'd\u0430t\u0430');
    expect(result!.passName).toBe('unicode_normalized');
  });

  it('confusable matches stay ambiguous when all lines are identical', () => {
    const content = Array.from({ length: 20 }, () => 'd\u0430t\u0430;').join('\n');
    const outcome = resolveBlocks(
      content,
      [{ path: 'f.ts', oldText: 'data;', newText: 'DATА;' }],
      'f.ts',
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('ambiguous');
  });
});
