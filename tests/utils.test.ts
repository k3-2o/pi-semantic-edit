import { describe, expect, it } from 'bun:test';
import {
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  normalizeForMatching,
  generateDiff,
  generateUnifiedPatch,
} from '../src/utils';

describe('detectLineEnding', () => {
  it('detects LF', () => {
    expect(detectLineEnding('a\nb\n')).toBe('\n');
  });
  it('detects CRLF', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n');
  });
  it('defaults to LF when no newlines', () => {
    expect(detectLineEnding('ab')).toBe('\n');
  });
  it('prefers CRLF when both present and CRLF comes first', () => {
    expect(detectLineEnding('a\r\nb\n')).toBe('\r\n');
  });
  it('prefers LF when LF comes first', () => {
    expect(detectLineEnding('a\nb\r\n')).toBe('\n');
  });
});

describe('normalizeToLF', () => {
  it('converts CRLF to LF', () => {
    expect(normalizeToLF('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('converts bare CR to LF', () => {
    expect(normalizeToLF('a\rb\r')).toBe('a\nb\n');
  });
  it('leaves LF unchanged', () => {
    expect(normalizeToLF('a\nb\n')).toBe('a\nb\n');
  });
});

describe('restoreLineEndings', () => {
  it('restores CRLF', () => {
    expect(restoreLineEndings('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
  });
  it('preserves LF', () => {
    expect(restoreLineEndings('a\nb\n', '\n')).toBe('a\nb\n');
  });
});

describe('stripBom', () => {
  it('strips BOM', () => {
    const result = stripBom('\uFEFFabc');
    expect(result.bom).toBe('\uFEFF');
    expect(result.text).toBe('abc');
  });
  it('returns empty BOM when not present', () => {
    const result = stripBom('abc');
    expect(result.bom).toBe('');
    expect(result.text).toBe('abc');
  });
});

describe('normalizeForMatching', () => {
  it('strips trailing whitespace', () => {
    expect(normalizeForMatching('a  \nb\t\n')).toBe('a\nb\n');
  });
  it('normalizes smart quotes', () => {
    expect(normalizeForMatching('\u2018hi\u2019')).toBe("'hi'");
  });
  it('normalizes dashes', () => {
    expect(normalizeForMatching('\u2014hello')).toBe('-hello');
  });
  it('normalizes NBSP', () => {
    expect(normalizeForMatching('a\u00A0b')).toBe('a b');
  });
  it('converts CRLF to LF', () => {
    expect(normalizeForMatching('a\r\nb\r\n')).toBe('a\nb\n');
  });
});

describe('generateDiff', () => {
  it('produces empty diff for identical content', () => {
    const result = generateDiff('a\nb\nc\n', 'a\nb\nc\n');
    expect(result.diff).toBe('');
  });

  it('shows removed lines', () => {
    const result = generateDiff('a\nb\nc\n', 'a\nc\n');
    expect(result.diff).toContain('-');
    expect(result.firstChangedLine).toBe(2);
  });

  it('shows added lines', () => {
    const result = generateDiff('a\nc\n', 'a\nb\nc\n');
    expect(result.diff).toContain('+');
    expect(result.firstChangedLine).toBe(2);
  });

  it('captures first changed line', () => {
    const result = generateDiff('a\nb\nc\n', 'a\nx\nc\n');
    expect(result.firstChangedLine).toBe(2);
  });
});

describe('generateUnifiedPatch', () => {
  it('produces valid patch headers', () => {
    const patch = generateUnifiedPatch('test.txt', 'a\nb\nc\n', 'a\nx\nc\n');
    expect(patch).toContain('--- test.txt');
    expect(patch).toContain('+++ test.txt');
    expect(patch).toContain('@@');
  });

  it('returns empty hunk count for identical content', () => {
    const patch = generateUnifiedPatch('test.txt', 'a\nb\n', 'a\nb\n');
    expect(patch).toBe('--- test.txt\n+++ test.txt');
  });
});
