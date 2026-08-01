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
