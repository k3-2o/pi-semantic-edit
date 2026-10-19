import { describe, expect, it } from 'bun:test';
import { findClosestCandidate } from '../src/domain/closest';

describe('findClosestCandidate', () => {
  it('finds a near-miss window anchored on the first query line', () => {
    const original =
      'fn setup() {\n    init();\n}\n\nfn main() {\n    let x = compute();\n    println!("{}", x);\n}';
    const old = 'fn main() {\n    let x = calculate();\n    println!("{}", x);\n}';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.candidate).toContain('fn main()');
    expect(candidate!.candidate).toContain('let x = compute();');
    expect(candidate!.startLine).toBe(5);
    expect(candidate!.similarity).toBeGreaterThan(0);
  });

  it('returns best of multiple candidates', () => {
    const original = 'first\naaa\nbest match here\nend\nfirst\nbbb\nworse match\nend';
    const old = 'first\nbest match here\nend';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.candidate).toContain('best match here');
  });

  it('null when no anchor line exists', () => {
    const original = 'x y z\nq r s';
    const old = 'nothing-here\nat all';
    expect(findClosestCandidate(original, old)).toBeNull();
  });

  it('handles empty old content', () => {
    expect(findClosestCandidate('anything', '   ')).toBeNull();
    expect(findClosestCandidate('anything', '')).toBeNull();
  });

  it('normalizes line endings', () => {
    const original = 'a\r\nb\r\nc';
    const candidate = findClosestCandidate(original, 'b\nc');
    expect(candidate).not.toBeNull();
    expect(candidate!.candidate).toBe('b\nc');
  });

  it('reports 1-indexed line range', () => {
    const original = 'l0\nl1\nanchor\nmid\nend\nl5';
    const candidate = findClosestCandidate(original, 'anchor\nmid\nend');
    expect(candidate!.startLine).toBe(3);
    expect(candidate!.endLine).toBe(5);
  });
});

describe('findClosestCandidate reach', () => {
  it('rescues when the first query line is wrong but a middle line matches', () => {
    const original = 'aaa\n  work();\nbbb\n';
    const old = 'GARBAGE LINE\n  work();\nBAZ';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.candidate).toContain('work();');
    expect(candidate!.startLine).toBe(2);
  });

  it('finds a region shorter than the query (model added a line)', () => {
    const original = 'l1\nl2\nl3\nl4\n';
    const old = 'l1\nl2\nl3\nl4\nl5';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.candidate).toBe('l1\nl2\nl3\nl4');
    expect(candidate!.startLine).toBe(1);
    expect(candidate!.endLine).toBe(4);
  });

  it('finds a region longer than the query (model dropped a line)', () => {
    const original = 'aaa\nmid\nmid2\nend\n';
    const old = 'aaa\nend';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.candidate).toContain('aaa');
    expect(candidate!.candidate).toContain('end');
  });

  it('reports which line differs and what the file has', () => {
    const original = 'aaa\nbbb-x\nccc\n';
    const old = 'aaa\nbbb\nccc';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.lineDiffs).toHaveLength(1);
    expect(candidate!.lineDiffs![0]).toEqual({
      lineNumber: 2,
      yours: 'bbb',
      file: 'bbb-x',
    });
  });

  it('returns no lineDiffs when the closest window is an exact text block', () => {
    const original = 'start\nkeep\nkeep2\nend\n';
    const old = 'start\nkeep\nkeep2\nend';
    const candidate = findClosestCandidate(original, old);
    expect(candidate).not.toBeNull();
    expect(candidate!.lineDiffs).toHaveLength(0);
  });

  it('keeps returning null when nothing is plausibly close', () => {
    const original = 'x y z\nq r s';
    const old = 'nothing-here\nat all';
    expect(findClosestCandidate(original, old)).toBeNull();
  });

  it('single-line closest still works', () => {
    const original = 'aa\nbbb\ncc\n';
    const candidate = findClosestCandidate(original, 'bbc');
    expect(candidate).not.toBeNull();
    expect(candidate!.startLine).toBe(2);
  });
});
