import { describe, expect, it } from 'bun:test';
import { parseSearchReplaceBlocks } from '../src/matcher';

describe('SEARCH/REPLACE block parser', () => {
  it('parses a basic block', () => {
    const input = `src/foo.ts
<<<<<<< SEARCH
    console.log('hello');
=======
    console.log('goodbye');
>>>>>>> REPLACE`;
    const result = parseSearchReplaceBlocks(input);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('src/foo.ts');
    expect(result[0].oldText).toBe("    console.log('hello');");
    expect(result[0].newText).toBe("    console.log('goodbye');");
  });

  it('parses multiple blocks', () => {
    const input = `src/a.ts
<<<<<<< SEARCH
old1
=======
new1
>>>>>>> REPLACE
src/b.ts
<<<<<<< SEARCH
old2
=======
new2
>>>>>>> REPLACE`;
    const result = parseSearchReplaceBlocks(input);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('src/a.ts');
    expect(result[0].oldText).toBe('old1');
    expect(result[1].path).toBe('src/b.ts');
    expect(result[1].newText).toBe('new2');
  });

  it('handles blocks without a file path (uses last seen path)', () => {
    const input = `src/foo.ts
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
<<<<<<< SEARCH
old2
=======
new2
>>>>>>> REPLACE`;
    const result = parseSearchReplaceBlocks(input);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('src/foo.ts');
    expect(result[1].path).toBe('src/foo.ts');
  });

  it('returns empty array for input with no valid blocks', () => {
    const result = parseSearchReplaceBlocks('some random text\nwith no blocks');
    expect(result).toHaveLength(0);
  });
});
