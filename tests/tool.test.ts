import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRobustEditTool } from '../src/pi/tool';

let dir: string;
let cwd: string;
let tool: ReturnType<typeof createRobustEditTool>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pi-robust-edit-'));
  cwd = dir;
  tool = createRobustEditTool(cwd, {} as never);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeFixture(name: string, content: string): Promise<string> {
  const filePath = join(dir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

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
    expect(result.content[0].text).toBe('Successfully replaced 1 block(s) in simple.ts.');
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
    expect(result.content[0].text).toBe('Successfully replaced 1 block(s) in fuzzy.ts.');
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
    expect(result.content[0].text).toBe('Successfully replaced 2 block(s) in multi.ts.');
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
    expect(result.content[0].text).toBe('Successfully replaced 1 block(s) in rename.ts.');
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
    const bogusTool = createRobustEditTool('/nonexistent-launch-dir', {} as never);
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

  it('surfaces a malformed aider patch as a typed malformed-patch error (not a raw exception)', async () => {
    const err = await tool
      .execute(
        '1',
        { patch: 'bad.ts\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE' } as never,
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e) => e);
    expect(err).not.toBeNull();
    expect(err.editError.kind).toBe('malformed-patch');
    expect((err as Error).message).toContain('SEARCH block with no content');
  });

  it('reports a missing path as a typed missing-path error (A-2)', async () => {
    const err = await tool
      .execute(
        '1',
        { patch: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE' } as never,
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e) => e);
    expect(err).not.toBeNull();
    expect(err.editError.kind).toBe('missing-path');
  });

  it('applies a multi-line edit to a CRLF file (preview and apply agree on LF content)', async () => {
    const p = join(dir, 'crlf.ts');
    await writeFile(p, 'let a = 1;\r\nlet b = 2;\r\n', 'utf-8');
    const result = await tool.execute(
      '1',
      editsFor('crlf.ts', [
        { oldText: 'let a = 1;\nlet b = 2;', newText: 'let a = 9;\nlet b = 8;' },
      ]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(p, 'utf-8')).toBe('let a = 9;\r\nlet b = 8;\r\n');
  });
});

interface FakeHarness {
  pi: { on: (event: string, handler: (e: unknown, ctx?: unknown) => void) => () => void };
  emit: (event: string, payload: unknown, ctx?: unknown) => Promise<void>;
}

function fakePi(): FakeHarness {
  const handlers: Record<string, ((e: unknown, ctx?: unknown) => void)[]> = {};
  return {
    pi: {
      on(event: string, handler: (e: unknown, ctx?: unknown) => void) {
        (handlers[event] ??= []).push(handler);
        return () => {};
      },
    },
    async emit(event: string, payload: unknown, ctx?: unknown) {
      for (const h of handlers[event] ?? []) await h(payload, ctx);
    },
  };
}

async function simulateRead(harness: FakeHarness, path: string, ctx?: { cwd?: string }) {
  await harness.emit(
    'tool_result',
    {
      toolName: 'read',
      toolCallId: 'r1',
      input: { path },
      content: [{ type: 'text', text: 'file' }],
      isError: false,
    },
    ctx,
  );
}

async function simulateOwnEdit(harness: FakeHarness, input: unknown, isError = false) {
  await harness.emit('tool_result', {
    toolName: 'edit',
    toolCallId: 'e1',
    input,
    content: [{ type: 'text', text: '' }],
    isError,
  });
}

async function simulateWrite(harness: FakeHarness, input: unknown, ctx?: { cwd?: string }) {
  await harness.emit(
    'tool_result',
    {
      toolName: 'write',
      toolCallId: 'w1',
      input,
      content: [{ type: 'text', text: '' }],
      isError: false,
    },
    ctx,
  );
}

describe('stale-read guard (integration)', () => {
  let harness: FakeHarness;
  let stTool: ReturnType<typeof createRobustEditTool>;

  beforeAll(() => {
    harness = fakePi();
    stTool = createRobustEditTool(cwd, harness.pi as never);
  });

  it('refuses an edit that absorbed content drift after the model read', async () => {
    await writeFixture('b3.ts', 'function b() {\n  return 2;\n}\n');
    await simulateRead(harness, 'b3.ts', { cwd });

    await writeFile(join(dir, 'b3.ts'), 'function b() {\n  return 2; // drifted\n}\n', 'utf-8');

    const err = await stTool
      .execute(
        '1',
        editsFor('b3.ts', [
          {
            oldText: 'function b() {\n  return 2;\n}\n',
            newText: 'function b() {\n  return 2;\n};\n',
          },
        ]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e: Error & { editError?: { kind?: string } }) => e);

    expect(err).not.toBeNull();
    expect(err?.editError?.kind).toBe('stale-read');
    expect(err?.message).toContain('line 2');
    expect(await readFile(join(dir, 'b3.ts'), 'utf-8')).toBe(
      'function b() {\n  return 2; // drifted\n}\n',
    );
  });

  it('refuses a simple match nested inside a changed token (bbb inside bbb-x)', async () => {
    await writeFixture('b2.ts', 'aaa\nbbb\nccc\n');
    await simulateRead(harness, 'b2.ts', { cwd });
    await writeFile(join(dir, 'b2.ts'), 'aaa\nbbb-x\nccc\n', 'utf-8');

    const err = await stTool
      .execute(
        '1',
        editsFor('b2.ts', [{ oldText: 'bbb', newText: 'BBB' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e: Error & { editError?: { kind?: string } }) => e);

    expect(err?.editError?.kind).toBe('stale-read');
    expect(err?.message).toContain('currently: bbb-x');
    expect(await readFile(join(dir, 'b2.ts'), 'utf-8')).toBe('aaa\nbbb-x\nccc\n');
  });

  it('refuses an insert anchored on a line that drifted after read (context_aware)', async () => {
    await writeFixture('race.ts', 'aaa\nbbb\nccc\n');
    await simulateRead(harness, 'race.ts', { cwd });
    await writeFile(join(dir, 'race.ts'), 'aaa\nbbb-x\nccc\n', 'utf-8');

    const err = await stTool
      .execute(
        '1',
        editsFor('race.ts', [{ oldText: 'bbb\nccc', newText: 'bbb\nBB1\nBB2\nccc' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e: Error & { editError?: { kind?: string } }) => e);

    expect(err?.editError?.kind).toBe('stale-read');
    expect(err?.message).toContain('line 2');
    expect(await readFile(join(dir, 'race.ts'), 'utf-8')).toBe('aaa\nbbb-x\nccc\n');
  });

  it('recovers: after refusal, a re-read lets the edit land against current content', async () => {
    await writeFixture('rec.ts', 'aaa\nbbb\nccc\n');
    await simulateRead(harness, 'rec.ts', { cwd });
    await writeFile(join(dir, 'rec.ts'), 'aaa\nbbb-x\nccc\n', 'utf-8');

    await stTool
      .execute(
        '1',
        editsFor('rec.ts', [{ oldText: 'bbb', newText: 'BBB' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch(() => null);
    expect(await readFile(join(dir, 'rec.ts'), 'utf-8')).toBe('aaa\nbbb-x\nccc\n');

    await simulateRead(harness, 'rec.ts', { cwd });
    const result = await stTool.execute(
      '2',
      editsFor('rec.ts', [{ oldText: 'bbb-x', newText: 'BBB' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'rec.ts'), 'utf-8')).toBe('aaa\nBBB\nccc\n');
  });

  it('allows an edit when the change is far from the target (no boundary, no absorbed drift)', async () => {
    await writeFixture('far.ts', 'aaa\nbbb\nccc\n');
    await simulateRead(harness, 'far.ts', { cwd });
    await writeFile(join(dir, 'far.ts'), 'aaa-x\nbbb\nccc\n', 'utf-8');

    const result = await stTool.execute(
      '1',
      editsFor('far.ts', [{ oldText: 'bbb', newText: 'BBB' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'far.ts'), 'utf-8')).toBe('aaa-x\nBBB\nccc\n');
  });

  it('allows rewrite-then-edit through our own edit tool without re-reading', async () => {
    await writeFixture('rw.ts', 'old content\n');

    const result = await stTool.execute(
      '1',
      editsFor('rw.ts', [{ oldText: 'old content\n', newText: 'first\nsecond\n' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    await simulateOwnEdit(harness, { path: 'rw.ts', edits: [] });

    const result2 = await stTool.execute(
      '2',
      editsFor('rw.ts', [{ oldText: 'first\nsecond\n', newText: 'first\nSECOND\n' }]),
      undefined,
      undefined,
      {},
    );
    expect(result2.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'rw.ts'), 'utf-8')).toBe('first\nSECOND\n');
  });

  it('allows blinder edits (no read at all) — status-quo tolerance', async () => {
    await writeFixture('blind.ts', 'aaa\nbbb\nccc\n');

    await writeFile(join(dir, 'blind.ts'), 'aaa\nbbb-x\nccc\n', 'utf-8');
    const err = await stTool
      .execute(
        '1',
        editsFor('blind.ts', [{ oldText: 'bbb', newText: 'BBB' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e: Error & { editError?: { kind?: string } }) => e);
    expect(err).toBeNull();
  });

  it('a failed edit does not refresh the snapshot (guard still fires next time)', async () => {
    await writeFixture('noref.ts', 'aaa\nbbb\nccc\n');
    await simulateRead(harness, 'noref.ts', { cwd });
    await simulateOwnEdit(harness, { path: 'noref.ts' }, true);
    await writeFile(join(dir, 'noref.ts'), 'aaa\nbbb-x\nccc\n', 'utf-8');

    const err = await stTool
      .execute(
        '1',
        editsFor('noref.ts', [{ oldText: 'bbb', newText: 'BBB' }]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e: Error & { editError?: { kind?: string } }) => e);
    expect(err?.editError?.kind).toBe('stale-read');
  });

  it('seeds an empty file via oldText "" (no read needed, no guard trip)', async () => {
    await writeFixture('seed.txt', '');
    const result = await stTool.execute(
      '1',
      editsFor('seed.txt', [{ oldText: '', newText: 'first\nsecond' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'seed.txt'), 'utf-8')).toBe('first\nsecond');
  });

  it('the write tool refreshes the snapshot (bash-rewrite flow through write stays smooth)', async () => {
    await writeFixture('wtw.ts', 'old\n');

    await writeFile(join(dir, 'wtw.ts'), 'first\nsecond\n', 'utf-8');
    await simulateWrite(harness, { path: 'wtw.ts', content: 'first\nsecond\n' }, { cwd });

    const result = await stTool.execute(
      '1',
      editsFor('wtw.ts', [{ oldText: 'first\nsecond\n', newText: 'first\nSECOND\n' }]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'wtw.ts'), 'utf-8')).toBe('first\nSECOND\n');
  });
});

describe('legacy edit shapes survive pi argument validation (dogfood)', () => {
  it('edits as a JSON string passes the schema and lands the edit', async () => {
    await writeFile(join(dir, 'legacy-string.ts'), 'let x = 1;\n', 'utf-8');
    const rawArgs = {
      path: 'legacy-string.ts',
      edits: JSON.stringify([{ oldText: 'let x = 1;', newText: 'let x = 2;' }]),
    };
    const { Compile } = await import('typebox/compile');
    const validator = Compile((await import('../src/pi/schema')).editToolSchema);
    expect(validator.Check(rawArgs)).toBe(true);
    const prepared = tool.prepareArguments(rawArgs);
    expect(validator.Check(prepared)).toBe(true);
    expect(prepared.edits).toHaveLength(1);
    const result = await tool.execute('1', prepared, undefined, undefined, {});
    expect(result.content[0].text).toContain('Successfully replaced');
    expect(await readFile(join(dir, 'legacy-string.ts'), 'utf-8')).toBe('let x = 2;\n');
  });

  it('edits as a single edit object is normalized', async () => {
    await writeFile(join(dir, 'legacy-obj.ts'), 'aaa\nbbb\nccc\n', 'utf-8');
    const rawArgs = { path: 'legacy-obj.ts', edits: { oldText: 'bbb', newText: 'BBB' } };
    const prepared = tool.prepareArguments(rawArgs) as {
      path: string;
      edits: { oldText: string; newText: string; replaceAll: boolean }[];
    };
    expect(prepared.edits).toHaveLength(1);
    expect(prepared.edits[0].oldText).toBe('bbb');
    expect(prepared.edits[0].newText).toBe('BBB');
    await tool.execute('1', prepared, undefined, undefined, {});
    expect(await readFile(join(dir, 'legacy-obj.ts'), 'utf-8')).toBe('aaa\nBBB\nccc\n');
  });

  it('garbage edits JSON string yields a precise error', async () => {
    const rawArgs = { path: 'legacy-bad.ts', edits: '{not json' };
    const prepared = tool.prepareArguments(rawArgs);
    expect(typeof prepared.edits).toBe('string');
    const err = await tool
      .execute('1', prepared, undefined, undefined, {})
      .then(() => null)
      .catch((e) => e);
    expect((err as Error).message).toContain('JSON string that did not parse');
  });
});

describe('stale-read guard span overlap (no false kick-in)', () => {
  let harness: FakeHarness;
  let stTool: ReturnType<typeof createRobustEditTool>;

  beforeAll(() => {
    harness = fakePi();
    stTool = createRobustEditTool(cwd, harness.pi as never);
  });

  it('allows a content-absorbing edit when the external change is far from the span', async () => {
    await writeFixture('far-block.ts', 'aaa\n  return data * 2;\nccc\n\n\nzzz external target\n');
    await simulateRead(harness, 'far-block.ts', { cwd });
    await writeFile(
      join(dir, 'far-block.ts'),
      'aaa\n  return data * 2;\nccc\n\n\nZZZ CHANGED EXTERNALLY\n',
      'utf-8',
    );

    const result = await stTool.execute(
      '1',
      editsFor('far-block.ts', [
        {
          oldText: 'aaa\n  return data * 3;\nccc',
          newText: 'aaa\n  return data * 4;\nccc',
        },
      ]),
      undefined,
      undefined,
      {},
    );
    expect(result.content[0].text).toBe('Successfully replaced 1 block(s) in far-block.ts.');
    expect(await readFile(join(dir, 'far-block.ts'), 'utf-8')).toBe(
      'aaa\n  return data * 4;\nccc\n\n\nZZZ CHANGED EXTERNALLY\n',
    );
  });

  it('refuses when the external change is inside the matched span (block_anchor)', async () => {
    await writeFixture('near-block.ts', 'aaa\n  return data * 2;\nccc\n\nzzz\n');
    await simulateRead(harness, 'near-block.ts', { cwd });
    await writeFile(
      join(dir, 'near-block.ts'),
      'aaa\n  return data * 2; // drifted\nccc\n\nzzz\n',
      'utf-8',
    );

    const err = await stTool
      .execute(
        '1',
        editsFor('near-block.ts', [
          {
            oldText: 'aaa\n  return data * 3;\nccc',
            newText: 'aaa\n  return data * 4;\nccc',
          },
        ]),
        undefined,
        undefined,
        {},
      )
      .then(() => null)
      .catch((e: Error & { editError?: { kind?: string } }) => e);
    expect(err?.editError?.kind).toBe('stale-read');
    expect(await readFile(join(dir, 'near-block.ts'), 'utf-8')).toBe(
      'aaa\n  return data * 2; // drifted\nccc\n\nzzz\n',
    );
  });
});
