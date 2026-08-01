import { describe, expect, it } from 'bun:test';
import { MalformedPatchError, parseAiderBlocks } from '../src/domain/parser';

describe('parseAiderBlocks: canonical fenced form', () => {
  it('parses a single fenced block with path header', () => {
    const patch = [
      'src/foo.ts',
      '```',
      '<<<<<<< SEARCH',
      '    console.log("hello");',
      '=======',
      '    console.log("goodbye");',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n');

    const blocks = parseAiderBlocks(patch);
    expect(blocks).toEqual([
      {
        path: 'src/foo.ts',
        oldText: '    console.log("hello");',
        newText: '    console.log("goodbye");',
      },
    ]);
  });

  it('accepts a language hint on the fence', () => {
    const patch = [
      'src/foo.ts',
      '```diff',
      '<<<<<<< SEARCH',
      'a',
      '=======',
      'b',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].oldText).toBe('a');
    expect(blocks[0].newText).toBe('b');
  });

  it('parses multiple fenced blocks with per-block paths', () => {
    const patch = [
      'a.ts',
      '```',
      '<<<<<<< SEARCH',
      'x1',
      '=======',
      'y1',
      '>>>>>>> REPLACE',
      '```',
      'b.ts',
      '```',
      '<<<<<<< SEARCH',
      'x2',
      '=======',
      'y2',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks.map((b) => b.path)).toEqual(['a.ts', 'b.ts']);
    expect(blocks[1].oldText).toBe('x2');
  });
});

describe('parseAiderBlocks: bare (unfenced) form', () => {
  it('parses path + block without fences', () => {
    const patch = ['src/foo.ts', '<<<<<<< SEARCH', 'old', '=======', 'new', '>>>>>>> REPLACE'].join(
      '\n',
    );
    const blocks = parseAiderBlocks(patch);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].path).toBe('src/foo.ts');
  });

  it('reuses the previous path when a block has no header', () => {
    const patch = [
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'a',
      '=======',
      'b',
      '>>>>>>> REPLACE',
      '<<<<<<< SEARCH',
      'c',
      '=======',
      'd',
      '>>>>>>> REPLACE',
    ].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks.map((b) => b.path)).toEqual(['src/foo.ts', 'src/foo.ts']);
  });

  it('blank-path block yields empty path (tool validates later)', () => {
    const patch = ['<<<<<<< SEARCH', 'a', '=======', 'b', '>>>>>>> REPLACE'].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].path).toBe('');
  });
});

describe('parseAiderBlocks: edge cases', () => {
  it('treats ======= inside the new phase as content', () => {
    const patch = [
      'f.ts',
      '<<<<<<< SEARCH',
      'old',
      '=======',
      '=======',
      '=======',
      'new',
      '>>>>>>> REPLACE',
    ].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks[0].newText).toBe('=======\n=======\nnew');
  });

  it('multi-line content preserves whitespace exactly', () => {
    const patch = [
      'f.ts',
      '```',
      '<<<<<<< SEARCH',
      'def foo():',
      '    return 1',
      '=======',
      'def foo():',
      '    return 2',
      '>>>>>>> REPLACE',
      '```',
    ].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks[0].oldText).toBe('def foo():\n    return 1');
    expect(blocks[0].newText).toBe('def foo():\n    return 2');
  });

  it('empty patch yields no blocks', () => {
    expect(parseAiderBlocks('')).toEqual([]);
  });

  it('garbage without markers yields no blocks', () => {
    expect(parseAiderBlocks('just some text\nnothing to see')).toEqual([]);
  });

  it('trailing text after blocks is ignored', () => {
    const patch = [
      'f.ts',
      '<<<<<<< SEARCH',
      'a',
      '=======',
      'b',
      '>>>>>>> REPLACE',
      'this is a note to the agent',
    ].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks).toHaveLength(1);
  });

  it('empty SEARCH/REPLACE block throws MalformedPatchError', () => {
    const patch = ['f.ts', '<<<<<<< SEARCH', '=======', '>>>>>>> REPLACE'].join('\n');
    expect(() => parseAiderBlocks(patch)).toThrow(MalformedPatchError);
  });

  it('unterminated block consumes to end without throwing', () => {
    // Missing REPLACE marker: block runs to end of input.
    const patch = ['f.ts', '<<<<<<< SEARCH', 'a', '=======', 'b'].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].newText).toBe('b');
  });

  it('indented markers inside content are respected at line start', () => {
    // A line starting with spaces then >>>>>>> still terminates (aider parity:
    // markers are matched with leading whitespace tolerance).
    const patch = ['f.ts', '<<<<<<< SEARCH', 'a', '=======', 'b', '  >>>>>>> REPLACE'].join('\n');
    const blocks = parseAiderBlocks(patch);
    expect(blocks).toHaveLength(1);
  });
});
