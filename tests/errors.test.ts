import { describe, expect, it } from 'bun:test';
import {
  ambiguousError,
  fileNotFoundError,
  malformedPatchError,
  missingPathError,
  noOpError,
  notFoundError,
  overlappingError,
  validationError,
} from '../src/domain/errors';

describe('error builders', () => {
  it('ambiguous lists 1-indexed line positions', () => {
    const err = ambiguousError('src/foo.ts', 3, [3, 7, 12]);
    expect(err.kind).toBe('ambiguous');
    expect(err.message).toContain('3 times');
    expect(err.message).toContain('line 3, line 7, line 12');
    expect(err.message).toContain('Provide more surrounding context');
    expect(err.linePositions).toEqual([3, 7, 12]);
  });

  it('not-found without closest is a bare error with next-move', () => {
    const err = notFoundError('src/foo.ts');
    expect(err.kind).toBe('not-found');
    expect(err.closestCandidate).toBeUndefined();
    expect(err.message).toContain('not found in src/foo.ts');
    expect(err.message).toContain('Re-read the file');
    expect(err.message).toContain('retry with the exact text');
  });

  it('not-found with closest includes candidate preview and similarity', () => {
    const err = notFoundError('src/foo.ts', {
      passName: 'closest-candidate',
      similarity: 0.63,
      candidate: '    let x = compute();\n    println!("{}", x);',
      startLine: 6,
      endLine: 7,
    });
    expect(err.kind).toBe('not-found');
    expect(err.message).toContain('63% similar');
    expect(err.message).toContain('lines 6-7');
    expect(err.message).toContain('let x = compute();');
    expect(err.closestCandidate!.similarity).toBe(0.63);
  });

  it('single-line closest candidate says line not lines', () => {
    const err = notFoundError('f.ts', {
      passName: 'closest-candidate',
      similarity: 0.5,
      candidate: 'single line',
      startLine: 4,
      endLine: 4,
    });
    expect(err.message).toContain('line 4');
    expect(err.message).not.toContain('lines 4');
  });

  it('abbreviates long candidates', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i} `.repeat(30)).join('\n');
    const err = notFoundError('f.ts', {
      passName: 'closest-candidate',
      similarity: 0.4,
      candidate: long,
      startLine: 1,
      endLine: 20,
    });
    expect(err.message.split('\n').length).toBeLessThanOrEqual(12);
    expect(err.message).toContain('…');
  });

  it('malformed patch includes line number', () => {
    const err = malformedPatchError('SEARCH block with no content', 4);
    expect(err.kind).toBe('malformed-patch');
    expect(err.message).toContain('(line 5)');
  });

  it('other builders are well-formed with next-move guidance', () => {
    expect(missingPathError().kind).toBe('missing-path');
    expect(fileNotFoundError('x.ts').message).toContain('File not found: x.ts');
    expect(fileNotFoundError('x.ts').message).toContain('use write to create the file');
    expect(overlappingError('edit A overlaps edit B').message).toContain('Overlapping edits');
    expect(overlappingError('edit A overlaps edit B').message).toContain('disjoint region');
    expect(noOpError().kind).toBe('no-op');
    expect(noOpError().message).toContain('Change newText');
    expect(validationError('oldText is empty').kind).toBe('validation');
  });
});
