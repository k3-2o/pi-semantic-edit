// Integration tests for the tool adapter — temp files, atomic write, error
// paths, stale-read wiring, replaceAll, deprecated aider input. Runs the
// tool's execute() directly with a mocked pi surface.

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

/** Primary-contract args helper: { path, edits: [{oldText, newText, replaceAll?}] }. */
function editsFor(
  path: string,
  edits: { oldText: string; newText: string; replaceAll?: boolean }[],
) {
  return { path, edits };
}

describe('edit tool execute (primary contract)', () => {
  it('applies a simple edit and writes atomically', async () => {
    await writeFixture('simple.ts', 'let x = 1;\n');
    const result = await tool.execute(
      '1',
      editsFor('simple.ts', [{ oldText: 'let x = 1;', newText: 'let x = 2;' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced 1 replacement');
    expect(await readFile(join(dir, 'simple.ts'), 'utf-8')).toBe('let x = 2;\n');
    expect(result.details.diff).toContain('-1 let x = 1;');
  });

  it('applies fuzzy edits (whitespace drift) and reports match pass', async () => {
    await writeFixture('fuzzy.ts', 'let   x  =   1;\n');
    const result = await tool.execute(
      '1',
      editsFor('fuzzy.ts', [{ oldText: 'let x = 1;', newText: 'let x = 2;' }]),
      undefined,
      undefined,
      {},
    );
    expect(await readFile(join(dir, 'fuzzy.ts'), 'utf-8')).toBe('let x = 2;\n');
    expect(result.details.matchPasses).toContain('whitespace_normalized');
    expect(result.content[0].text).toContain('Match passes');
  });

  it('applies multiple edits in one call', async () => {
    await writeFixture('multi.ts', 'a\nb\nc\n');
    const result = await tool.execute(
      '1',
      editsFor('multi.ts', [
        { oldText: 'a', newText: 'A' },
        { oldText: 'c', newText: 'C' },
      ]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('2 edit(s)');
    expect(await readFile(join(dir, 'multi.ts'), 'utf-8')).toBe('A\nb\nC\n');
  });

  it('preserves CRLF line endings on write', async () => {
    await writeFixture('crlf.ts', 'line1\r\nold\r\nline3\r\n');
    const result = await tool.execute(
      '1',
      editsFor('crlf.ts', [{ oldText: 'old', newText: 'new' }]),
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
      editsFor('bom.ts', [{ oldText: 'hello', newText: 'goodbye' }]),
      undefined,
      undefined,
      {},
    );
    expect(await readFile(join(dir, 'bom.ts'), 'utf-8')).toBe('\uFEFFgoodbye\n');
  });

  it('replaceAll replaces every occurrence in one call', async () => {
    await writeFixture('rename.ts', 'const a = 1;\nconst b = a + a;\nconsole.log(a);\n');
    const result = await tool.execute(
      '1',
      editsFor('rename.ts', [{ oldText: 'a', newText: 'item', replaceAll: true }]),
      undefined,
      undefined,
      {},
    );
    expect(await readFile(join(dir, 'rename.ts'), 'utf-8')).toBe(
      'const item = 1;\nconst b = item + item;\nconsole.log(item);\n',
    );
    expect(result.content[0].text).toContain('4 replacements');
    expect(result.content[0].text).toContain('1 edit(s)');
    // one edit consumed 4 spans → 4 replace_all entries (per-span pass names)
    expect(result.details.matchPasses).toEqual([
      'replace_all',
      'replace_all',
      'replace_all',
      'replace_all',
    ]);
  });

  it('replaceAll replaces a multi-line block across occurrences', async () => {
    await writeFixture(
      'multi-rename.ts',
      'function f() {\n  const id = 1;\n  const label = "x";\n}\nfunction g() {\n  const id = 2;\n  const label = "y";\n}\n',
    );
    await tool.execute(
      '1',
      editsFor('multi-rename.ts', [
        {
          oldText: '  const id = 1;\n  const label = "x";',
          newText: '  const { id, label } = item;',
          replaceAll: true,
        },
      ]),
      undefined,
      undefined,
      {},
    );
    const content = await readFile(join(dir, 'multi-rename.ts'), 'utf-8');
    expect(content).toContain('function f() {\n  const { id, label } = item;\n}');
    expect(content).not.toContain('const id = 1;');
    // only the exact block (id=1/label="x") matched — the g() block stays
    expect(content).toContain('const id = 2;');
  });

  it('fails with file-not-found for missing files', async () => {
    const err = await tool
      .execute('1', editsFor('nope.ts', [{ oldText: 'x', newText: 'y' }]), undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect(err).not.toBeNull();
    expect((err as Error).message).toContain('File not found');
    expect(err.editError.kind).toBe('file-not-found');
  });

  it('fails with ambiguous error and line positions on duplicates', async () => {
    await writeFixture('dup.ts', 'foo foo\n');
    const err = await tool
      .execute(
        '1',
        editsFor('dup.ts', [{ oldText: 'foo', newText: 'baz' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('found 2 times');
    expect((err as Error).message).toContain('line 1, line 1');
    expect((err as Error).message).toContain('replaceAll');
    expect(err.editError.kind).toBe('ambiguous');
  });

  it('fails with closest-candidate on no match', async () => {
    await writeFixture('nomatch.ts', 'const actual = 42;\n');
    const err = await tool
      .execute(
        '1',
        editsFor('nomatch.ts', [{ oldText: 'const wrong = 42;', newText: 'const right = 1;' }]),
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
    await writeFixture('stale.ts', 'x\n');
    const mtime = Date.now() + 60_000;
    registry = new ReadRegistry({ stat: () => ({ mtimeMs: mtime }) });
    registry.record(join(dir, 'stale.ts'));
    const staleTool = createRobustEditTool(cwd, {} as never, registry);
    const err = await staleTool
      .execute(
        '1',
        editsFor('stale.ts', [{ oldText: 'x', newText: 'y' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('changed since you last read it');
    expect(err.editError.kind).toBe('stale-read');
  });

  it('self-refreshes the registry after a successful edit', async () => {
    const p = await writeFixture('refresh.ts', 'x\n');
    const reg = new ReadRegistry({ stat: () => ({ mtimeMs: Date.now() + 5000 }) });
    const freshTool = createRobustEditTool(cwd, {} as never, reg);
    await freshTool.execute(
      '1',
      editsFor('refresh.ts', [{ oldText: 'x', newText: 'y' }]),
      undefined,
      undefined,
      {},
    );
    expect(reg.lastRead(p)).toBeDefined();
  });

  it('rejects empty edits with a validation error', async () => {
    const err = await tool
      .execute('1', { path: 'x.ts', edits: [] }, undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('No edits found');
    expect(err.editError.kind).toBe('validation');
  });

  it('resolves paths against the SESSION cwd, not the load cwd', async () => {
    const realDir = dir;
    const bogusTool = createRobustEditTool('/nonexistent-launch-dir', {} as never, registry);
    await writeFixture('session-cwd.ts', 'let a = 1;\n');
    const result = await bogusTool.execute(
      '1',
      editsFor('session-cwd.ts', [{ oldText: 'let a = 1;', newText: 'let a = 2;' }]),
      undefined,
      undefined,
      { cwd: realDir },
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'session-cwd.ts'), 'utf-8')).toBe('let a = 2;\n');
  });

  it('returns unified patch in details (built-in parity)', async () => {
    await writeFixture('patch.ts', 'let x = 1;\n');
    const result = await tool.execute(
      '1',
      editsFor('patch.ts', [{ oldText: 'let x = 1;', newText: 'let x = 2;' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.details.patch).toContain('--- patch.ts');
    expect(result.details.patch).toContain('+++ patch.ts');
    expect(result.details.patch).toContain('-let x = 1;');
    expect(result.details.patch).toContain('+let x = 2;');
  });
});

describe('prepareArguments normalization', () => {
  it('passes primary edits[] through unchanged', () => {
    const input = {
      path: 'a.ts',
      edits: [
        { oldText: 'a', newText: 'b', replaceAll: true },
        { oldText: 'c', newText: 'd' },
      ],
    };
    // prepareArguments returns { path, edits } — each request carries its own
    // path (normalized shape) and replaceAll is explicit false when absent.
    expect(tool.prepareArguments(input)).toEqual({
      path: 'a.ts',
      edits: [
        { path: 'a.ts', oldText: 'a', newText: 'b', replaceAll: true },
        { path: 'a.ts', oldText: 'c', newText: 'd', replaceAll: false },
      ],
    });
  });

  it('parses edits passed as a JSON string (built-in parity)', () => {
    const prepared = tool.prepareArguments({
      path: 'legacy.ts',
      edits: JSON.stringify([
        { oldText: 'a', newText: 'b' },
        { oldText: 'c', newText: 'd' },
      ]),
    });
    expect(prepared.path).toBe('legacy.ts');
    expect(prepared.edits).toHaveLength(2);
    expect(prepared.edits[0].oldText).toBe('a');
    // malformed JSON string falls through unchanged
    expect(tool.prepareArguments({ path: 'x.ts', edits: 'not-json' })).toEqual({
      path: 'x.ts',
      edits: 'not-json',
    });
  });

  it('merges legacy top-level oldText/newText into edits[]', () => {
    const prepared = tool.prepareArguments({ path: 'legacy.ts', oldText: 'a', newText: 'b' });
    expect(prepared.path).toBe('legacy.ts');
    expect(prepared.edits).toEqual([
      { path: 'legacy.ts', oldText: 'a', newText: 'b', replaceAll: false },
    ]);
  });

  it('normalizes a deprecated aider patch into edits[]', () => {
    const prepared = tool.prepareArguments({
      patch: 'src/foo.ts\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE',
    });
    expect(prepared.path).toBe('src/foo.ts');
    expect(prepared.edits).toEqual([
      { path: 'src/foo.ts', oldText: 'old', newText: 'new', replaceAll: false },
    ]);
  });

  it('execute still applies a deprecated aider patch (session resume)', async () => {
    await writeFixture('resume.ts', 'hello\n');
    const result = await tool.execute(
      '1',
      { patch: 'resume.ts\n<<<<<<< SEARCH\nhello\n=======\ngoodbye\n>>>>>>> REPLACE' } as never,
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'resume.ts'), 'utf-8')).toBe('goodbye\n');
  });
});
