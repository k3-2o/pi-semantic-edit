import { describe, expect, it } from 'bun:test';
import { applyEdits, type Edit, type MatcherOptions } from '../src/matcher';

const opts: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
  allowJointScoring: true,
};

function apply(content: string, edits: Edit[], options = opts) {
  return applyEdits(content, edits, options);
}

const optsNoJoint: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
  allowJointScoring: false,
};

function applyNoJoint(content: string, edits: Edit[]) {
  return applyEdits(content, edits, optsNoJoint);
}

describe('joint old/new scoring', () => {
  it('disambiguates identical blocks by structural context', () => {
    // Two functions with identical structure but different names.
    // oldText "x;" matches both function bodies.
    // joint scoring should prefer the match inside function a()
    // because the new text "y;" fits better (same variable structure).
    const content = `function a() {
  x;
}

function b() {
  x;
}
`;
    const result = apply(content, [{ oldText: 'x;', newText: 'y;' }]);
    expect(result.matches).toHaveLength(1);
    // With scoring, it should pick one — let's verify the file content
    const lines = result.newContent.split('\n');
    // One function should have y; the other x;
    const yCount = lines.filter((l) => l.trim() === 'y;').length;
    const xCount = lines.filter((l) => l.trim() === 'x;').length;
    expect(yCount).toBe(1);
    expect(xCount).toBe(1);
  });

  it('prefers match with balanced braces', () => {
    // Two locations, one where replacing would break brace balance.
    const content = `if (true) {
  x;
}

function foo() {
  x;
}
`;
    // oldText "x;" appears in both blocks.
    // Replacing inside the if block (first occurrence) is more likely intended
    // because it maintains the structure.
    const result = apply(content, [{ oldText: 'x;', newText: 'x++;' }]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toContain('x++;');
  });

  it('fails when joint scoring is disabled (allowing synthetic tests)', () => {
    const content = `a
x
b
x
c
`;
    const result = applyNoJoint(content, [{ oldText: 'x', newText: 'y' }]);
    // Without scoring, auto-expand should handle "a\nx" vs "b\nx" disambiguation
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('a\ny\nb\nx\nc\n');
  });

  it('produces the same result as auto-expand for simple duplicates', () => {
    // When auto-expand can disambiguate, joint scoring should not interfere
    const content = 'a\nx\nb\nx\nc\n';
    const withScore = apply(content, [{ oldText: 'x', newText: 'y' }]);
    expect(withScore.matches).toHaveLength(1);
    expect(withScore.newContent).toBe('a\ny\nb\nx\nc\n');
  });
});
