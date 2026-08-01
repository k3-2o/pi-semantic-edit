import { describe, expect, it } from 'bun:test';
import { coherenceCheck } from '../src/domain/coherence';

describe('coherenceCheck', () => {
  it('flags unbalanced braces', () => {
    const warnings = coherenceCheck('function a() {\n  return 1;\n');
    expect(warnings.some((w) => w.includes('Unclosed'))).toBe(true);
  });

  it('flags excess closing braces', () => {
    const warnings = coherenceCheck('function a() {\n}\n}');
    expect(warnings.some((w) => w.includes('Too many closing'))).toBe(true);
  });

  it('passes balanced code', () => {
    expect(coherenceCheck('function a() {\n  return 1;\n}')).toEqual([]);
  });

  it('flags suspicious indentation jumps', () => {
    const warnings = coherenceCheck('const x = 1;\n      const y = 2;');
    expect(warnings.some((w) => w.includes('indentation jump'))).toBe(true);
  });

  it('ignores blank lines when checking indentation', () => {
    expect(coherenceCheck('const x = 1;\n\nconst y = 2;')).toEqual([]);
  });

  it('reports the offending line number', () => {
    const warnings = coherenceCheck('a\nb\n          c');
    const jump = warnings.find((w) => w.includes('indentation jump'));
    expect(jump).toBeDefined();
    expect(jump).toContain('Line 3');
  });

  it('balanced nested structures pass', () => {
    expect(coherenceCheck('[\n  { a: (1) },\n  { b: [2] },\n]')).toEqual([]);
  });
});
