import { describe, expect, it } from 'bun:test';
import { applyEdits, type MatcherOptions } from '../src/matcher';

const opts: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
  allowJointScoring: true,
};

describe('failure-reporting improvements', () => {
  it('includes oldText preview in not-found message', () => {
    const content = 'a\nb\nc\n';
    const result = applyEdits(content, [{ oldText: 'z', newText: 'x' }], opts);
    expect(result.failed[0].reason).toContain('"z"');
  });

  it('shows similar lines when available', () => {
    const content = 'function hello() {\n  return 42;\n}\n';
    const result = applyEdits(
      content,
      [{ oldText: '  return 43;', newText: '  return 99;' }],
      opts,
    );
    expect(result.failed[0].reason).toContain('similar');
  });

  it('includes oldText preview in duplicate message', () => {
    const strictOpts: MatcherOptions = {
      allowNormalized: false,
      allowExpand: false,
      allowJointScoring: false,
    };
    const result = applyEdits('x\nmiddle\nx\n', [{ oldText: 'x', newText: 'y' }], strictOpts);
    expect(result.failed.length).toBeGreaterThan(0);
    const msg = result.failed[0].reason;
    expect(msg).toContain('multiple occurrences');
    expect(msg).toContain('"x"');
  });
});
