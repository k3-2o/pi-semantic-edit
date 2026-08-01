// Integration tests for the tool adapter — temp files, atomic write, error
// paths, stale-read wiring. Runs the tool's execute() directly with a mocked
// pi surface.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ReadRegistry } from '../src/domain/stale-read';
import { createRobustEditTool } from '../src/pi/tool';

let dir: string;
let cwd: string;
let registry: ReadRegistry;
let tool: ReturnType<typeof createRobustEditTool>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pi-robust-edit-'));
  cwd = dir;
  registry = new ReadRegistry({ stat: (_p) => ({ mtimeMs: Date.now() - 1000 }) });
  tool = createRobustEditTool(cwd, {} as never, registry);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, content: string): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

function patchFor(path: string, oldText: string, newText: string): string {
  return `${path}\n\`\`\`\n<<<<<<< SEARCH\n${oldText}\n=======\n${newText}\n>>>>>>> REPLACE\n\`\`\``;
}

describe('edit tool execute', () => {
  it('applies a simple edit and writes atomically', async () => {
    await writeFixture('simple.ts', 'let x = 1;\n');
    const result = await tool.execute(
      '1',
      { patch: patchFor('simple.ts', 'let x = 1;', 'let x = 2;') },
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced 1 block(s) in simple.ts.');
    expect(await readFile(join(dir, 'simple.ts'), 'utf-8')).toBe('let x = 2;\n');
    expect(result.details.diff).toContain('-1 let x = 1;');
  });

  it('applies fuzzy edits (whitespace drift) and reports match pass', async () => {
    await writeFixture('fuzzy.ts', 'let   x  =   1;\n');
    const result = await tool.execute(
      '1',
      { patch: patchFor('fuzzy.ts', 'let x = 1;', 'let x = 2;') },
      undefined,
      undefined,
      {},
    );
    expect(await readFile(join(dir, 'fuzzy.ts'), 'utf-8')).toBe('let x = 2;\n');
    expect(result.details.matchPasses).toContain('whitespace_normalized');
    expect(result.content[0].text).toContain('Match passes');
  });

  it('applies multiple blocks in one patch', async () => {
    await writeFixture('multi.ts', 'a\nb\nc\n');
    const patch = [
      'multi.ts',
      '<<<<<<< SEARCH',
      'a',
      '=======',
      'A',
      '>>>>>>> REPLACE',
      '<<<<<<< SEARCH',
      'c',
      '=======',
      'C',
      '>>>>>>> REPLACE',
    ].join('\n');
    const result = await tool.execute('1', { patch }, undefined, undefined, {});
    expect(result.content[0].text).toContain('2 block(s)');
    expect(await readFile(join(dir, 'multi.ts'), 'utf-8')).toBe('A\nb\nC\n');
  });

  it('preserves CRLF line endings on write', async () => {
    await writeFixture('crlf.ts', 'line1\r\nold\r\nline3\r\n');
    const result = await tool.execute(
      '1',
      { patch: patchFor('crlf.ts', 'old', 'new') },
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'crlf.ts'), 'utf-8')).toBe('line1\r\nnew\r\nline3\r\n');
  });

  it('preserves a UTF-8 BOM', async () => {
    await writeFixture('bom.ts', '\uFEFFhello\n');
    await tool.execute(
      '1',
      { patch: patchFor('bom.ts', 'hello', 'goodbye') },
      undefined,
      undefined,
      {},
    );
    expect(await readFile(join(dir, 'bom.ts'), 'utf-8')).toBe('\uFEFFgoodbye\n');
  });

  it('fails with file-not-found for missing files', async () => {
    const err = await tool
      .execute('1', { patch: patchFor('nope.ts', 'x', 'y') }, undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect(err).not.toBeNull();
    expect((err as Error).message).toContain('File not found');
    expect(err.editError.kind).toBe('file-not-found');
  });

  it('fails with ambiguous error and line positions on duplicates', async () => {
    // Two 'foo' occurrences on the SAME line: auto-expand is structurally
    // impossible — both occurrences expand to the whole line → both unique
    // simultaneously → genuinely ambiguous → error.
    await writeFixture('dup.ts', 'foo foo\n');
    const err = await tool
      .execute('1', { patch: patchFor('dup.ts', 'foo', 'baz') }, undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('found 2 times');
    expect((err as Error).message).toContain('line 1, line 1');
    expect(err.editError.kind).toBe('ambiguous');
  });

  it('fails with closest-candidate on no match', async () => {
    await writeFixture('nomatch.ts', 'const actual = 42;\n');
    const err = await tool
      .execute(
        '1',
        { patch: patchFor('nomatch.ts', 'const wrong = 42;', 'const right = 1;') },
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('not found');
    expect((err as Error).message).toContain('Closest match');
    expect(err.editError.kind).toBe('not-found');
    expect(err.editError.closestCandidate.candidate).toContain('const actual = 42;');
  });

  it('fails with stale-read when the file changed since the last read', async () => {
    const stalePath = join(dir, 'stale.ts');
    await writeFixture('stale.ts', 'x\n');
    // Simulate: model read at T, file externally modified after T
    const mtime = Date.now() + 60_000; // future mtime = modified after read
    registry = new ReadRegistry({ stat: () => ({ mtimeMs: mtime }) });
    registry.record(stalePath);
    const staleTool = createRobustEditTool(cwd, {} as never, registry);
    const err = await staleTool
      .execute('1', { patch: patchFor('stale.ts', 'x', 'y') }, undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('changed since you last read it');
    expect(err.editError.kind).toBe('stale-read');
  });

  it('self-refreshes the registry after a successful edit', async () => {
    const p = await writeFixture('refresh.ts', 'x\n');
    // fresh registry: never read → treated as fresh; after edit it is recorded
    const reg = new ReadRegistry({ stat: () => ({ mtimeMs: Date.now() + 5000 }) });
    const freshTool = createRobustEditTool(cwd, {} as never, reg);
    await freshTool.execute(
      '1',
      { patch: patchFor('refresh.ts', 'x', 'y') },
      undefined,
      undefined,
      {},
    );
    expect(reg.lastRead(p)).toBeDefined();
  });

  it('rejects malformed patches with a clear error', async () => {
    const err = await tool
      .execute('1', { patch: 'no markers here at all' }, undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('No valid SEARCH/REPLACE blocks');
    expect(err.editError.kind).toBe('validation');
  });

  it('rejects blocks without a path header', async () => {
    const err = await tool
      .execute(
        '1',
        { patch: '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE' },
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('file path');
    expect(err.editError.kind).toBe('missing-path');
  });

  it('resolves paths against the SESSION cwd, not the load cwd', async () => {
    // Simulate the reported bug: pi launched from a different directory than
    // the session's working dir. The tool is created with a bogus load cwd;
    // execute receives ctx.cwd = the real temp dir → must still work.
    const realDir = dir;
    const bogusTool = createRobustEditTool('/nonexistent-launch-dir', {} as never, registry);
    await writeFixture('session-cwd.ts', 'let a = 1;\n');
    const result = await bogusTool.execute(
      '1',
      { patch: patchFor('session-cwd.ts', 'let a = 1;', 'let a = 2;') },
      undefined,
      undefined,
      { cwd: realDir },
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'session-cwd.ts'), 'utf-8')).toBe('let a = 2;\n');
  });

  it('prepareArguments converts legacy edits[] shape to a patch', async () => {
    const prepared = tool.prepareArguments({
      path: 'legacy.ts',
      edits: [{ oldText: 'a', newText: 'b' }],
    });
    expect(prepared.patch).toContain('legacy.ts');
    expect(prepared.patch).toContain('<<<<<<< SEARCH');
    expect(tool.prepareArguments({ patch: 'already new' })).toEqual({ patch: 'already new' });
  });
});
