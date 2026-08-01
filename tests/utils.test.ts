import { describe, expect, it } from 'bun:test';
import {
  detectLineEnding,
  normalizeNewlines,
  restoreLineEndings,
  stripBom,
  resolveToCwd,
} from '../src/domain/utils';

describe('normalizeNewlines', () => {
  it('converts CRLF and lone CR to LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
  it('leaves LF untouched', () => {
    expect(normalizeNewlines('a\nb\n')).toBe('a\nb\n');
  });
  it('mixed endings normalize to LF', () => {
    expect(normalizeNewlines('a\r\nb\nc\r\nd')).toBe('a\nb\nc\nd');
  });
});

describe('detectLineEnding', () => {
  it('detects CRLF', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('\r\n');
  });
  it('detects LF', () => {
    expect(detectLineEnding('a\nb\n')).toBe('\n');
  });
  it('first line ending wins', () => {
    expect(detectLineEnding('a\r\nb\nc')).toBe('\r\n');
    expect(detectLineEnding('a\nb\r\nc')).toBe('\n');
  });
  it('no line endings → LF default', () => {
    expect(detectLineEnding('abc')).toBe('\n');
  });
});

describe('restoreLineEndings', () => {
  it('restores CRLF', () => {
    expect(restoreLineEndings('a\nb\n', '\r\n')).toBe('a\r\nb\r\n');
  });
  it('LF stays LF', () => {
    expect(restoreLineEndings('a\nb\n', '\n')).toBe('a\nb\n');
  });
  it('round-trips detect → normalize → restore', () => {
    const raw = 'line1\r\nline2\r\nline3';
    const ending = detectLineEnding(raw);
    const lf = normalizeNewlines(raw);
    expect(restoreLineEndings(lf, ending)).toBe(raw);
  });
});

describe('stripBom', () => {
  it('strips a UTF-8 BOM', () => {
    const { bom, text } = stripBom('\uFEFFhello');
    expect(bom).toBe('\uFEFF');
    expect(text).toBe('hello');
  });
  it('no BOM → empty bom', () => {
    const { bom, text } = stripBom('hello');
    expect(bom).toBe('');
    expect(text).toBe('hello');
  });
  it('BOM-only file', () => {
    const { bom, text } = stripBom('\uFEFF');
    expect(bom).toBe('\uFEFF');
    expect(text).toBe('');
  });
});

describe('resolveToCwd', () => {
  it('absolute paths pass through', () => {
    expect(resolveToCwd('/tmp/x.ts', '/home/u/proj')).toBe('/tmp/x.ts');
  });
  it('relative paths join cwd', () => {
    expect(resolveToCwd('src/x.ts', '/home/u/proj')).toBe('/home/u/proj/src/x.ts');
  });
  it('dot paths normalize', () => {
    expect(resolveToCwd('./x.ts', '/home/u/proj')).toBe('/home/u/proj/x.ts');
  });
  it('tilde expands to HOME', () => {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) {
      expect(resolveToCwd('~/x.ts', '/tmp')).toBe(`${home}/x.ts`);
    }
  });
});
