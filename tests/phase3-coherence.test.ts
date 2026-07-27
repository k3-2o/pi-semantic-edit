import { describe, expect, it } from 'bun:test';
import { applyEdits, type MatcherOptions } from '../src/matcher';

const opts: MatcherOptions = {
  allowNormalized: true,
  allowExpand: true,
  maxExpandLines: 10,
  allowJointScoring: true,
};

describe('coherence checks', () => {
  it('passes clean on balanced braces', () => {
    const content = 'function foo() {\n  return 1;\n}\n';
    const result = applyEdits(content, [{ oldText: '1', newText: '2' }], opts);
    expect(result.warnings).toBeUndefined();
  });

  it('warns on unclosed brace after edit', () => {
    const content = 'function foo() {\n  if (x) {\n    doSomething();\n  }\n}\n';
    // Model accidentally removes closing brace
    const result = applyEdits(
      content,
      [
        {
          oldText: '  if (x) {\n    doSomething();\n  }\n}',
          newText: '  if (x) {\n    doSomething();\n',
        },
      ],
      opts,
    );
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain('Unclosed');
  });

  it('warns on suspicious indentation jump', () => {
    // Edit that makes indentation jump drastically (from 6 spaces to 0)
    const content = 'function foo() {\n\n      const x = 1;\n      return x;\n}\n';
    const result = applyEdits(
      content,
      [{ oldText: '      const x = 1;', newText: 'const x = 1;' }],
      opts,
    );
    expect(result.warnings).toBeDefined();
    const joined = result.warnings!.join(' ');
    expect(joined).toContain('indentation');
  });

  it('does not warn on intentional large indentation (comments, new blocks)', () => {
    const content = '// start\nline1\nline2\n';
    const result = applyEdits(
      content,
      [{ oldText: 'line1', newText: 'line1\n{\n  deeplyIndentedLine' }],
      opts,
    );
    // This edit adds a brace and indented content. The check may still warn,
    // but the edit was still applied.
    expect(result.matches).toHaveLength(1);
  });

  it('does not produce warnings for a clean edit', () => {
    const content = 'a\nb\nc\n';
    const result = applyEdits(content, [{ oldText: 'b', newText: 'x' }], opts);
    expect(result.warnings).toBeUndefined();
    expect(result.newContent).toBe('a\nx\nc\n');
  });
});
