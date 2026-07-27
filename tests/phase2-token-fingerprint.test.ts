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

describe('token fingerprint matching', () => {
  it('disambiguates blocks that differ only in variable names', () => {
    // Two functions with identical structure but different variable names.
    // oldText "return data + 1" matches both.
    // Token fingerprint should prefer the one with matching variable name.
    const content = `def process_a(data):
    return data + 1

def process_b(info):
    return info + 1
`;
    const result = apply(content, [{ oldText: 'return data + 1', newText: 'return data + 2' }]);
    expect(result.matches).toHaveLength(1);
    const resultContent = result.newContent;
    // process_a should be modified, process_b should stay the same
    expect(resultContent).toContain('return data + 2');
    expect(resultContent).toContain('return info + 1');
  });

  it('prefers match where preserved identifier exists in context', () => {
    // Two nearly identical blocks with different identifiers.
    // The edit preserves the identifier "count", so the harness should
    // prefer the block where "count" appears in the surrounding context.
    const content = `function a() {
    const count = 0;
    if (cond) {
        return count;
    }
}

function b() {
    const items = [];
    if (cond) {
        return items;
    }
}
`;
    const result = apply(content, [
      {
        oldText: 'if (cond) {\n        return count;\n    }',
        newText: 'if (cond) {\n        return count + 1;\n    }',
      },
    ]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toContain('count + 1');
  });

  it('is not triggered for unique oldText (fingerprint not needed)', () => {
    // Single occurrence, token fingerprint should not interfere
    const content = 'const x = 1;\n';
    const result = apply(content, [{ oldText: 'const x = 1;', newText: 'const x = 2;' }]);
    expect(result.matches).toHaveLength(1);
    expect(result.newContent).toBe('const x = 2;\n');
  });
});
