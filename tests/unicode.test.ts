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
    // ﬁ (U+FB01) normalizes to "fi" — returns the verbatim ligature
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
    // whitespace drift is caught by whitespace_normalized (pass 4), not unicode
    const result = findMatch('let   x  =   1;', 'let x = 1;');
    expect(result!.passName).toBe('whitespace_normalized');
  });

  it('plain single-line drift is still a miss when unicode does not help', () => {
    // completely different text — unicode normalization doesn't rescue it
    expect(findMatch('abc def', 'xyz qrs')).toBeNull();
  });
});
