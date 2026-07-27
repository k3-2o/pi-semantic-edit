/**
 * Integration tests for the Pi tool wrapper (`tool.ts`).
 *
 * These tests exercise the execute function directly with temporary files,
 * verifying the full edit pipeline: file read, matcher, atomic write, diff output.
 *
 * The Pi runtime is not needed — we call the tool's execute function manually
 * and verify file results on disk.
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { mkdir, writeFile, rm } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createRobustEditTool } from '../src/tool';

// Create a temp workspace for each test run
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'pi-robust-edit-test-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Helper: write a file in the temp workspace and return its relative path. */
async function writeTestFile(name: string, content: string): Promise<string> {
  const filePath = resolve(tmpDir, name);
  await mkdir(resolve(tmpDir, 'sub'), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
  return name;
}

/** Helper: read a file from the temp workspace. */
function readTestFile(name: string): string {
  return readFileSync(resolve(tmpDir, name), 'utf-8');
}

/** Create the tool instance with a mock Pi extension API. */
function createTool() {
  const mockPi = {} as ExtensionAPI;
  return createRobustEditTool(tmpDir, mockPi);
}

describe('edit_robust tool: integration', () => {
  it('applies a simple exact-match edit', async () => {
    const file = await writeTestFile('simple.txt', 'a\nb\nc\n');
    const tool = createTool();
    const result = await tool.execute(
      '1',
      { path: file, edits: [{ oldText: 'b', newText: 'x' }] },
      undefined,
      undefined,
      undefined,
    );

    expect(readTestFile(file)).toBe('a\nx\nc\n');
    expect(result.content[0].text).toContain('Applied 1 edit');
  });

  it('applies a normalized match (trailing whitespace in oldText)', async () => {
    const file = await writeTestFile('trailing.txt', 'a\nb\nc\n');
    const tool = createTool();
    await tool.execute(
      '2',
      { path: file, edits: [{ oldText: 'b  ', newText: 'x' }] },
      undefined,
      undefined,
      undefined,
    );

    expect(readTestFile(file)).toBe('a\nx\nc\n');
  });

  it('applies edits with an anchor', async () => {
    const file = await writeTestFile('anchor.txt', 'function a() { x; }\nfunction b() { x; }\n');
    const tool = createTool();
    await tool.execute(
      '3',
      { path: file, edits: [{ anchor: 'function a()', oldText: 'x;', newText: 'y;' }] },
      undefined,
      undefined,
      undefined,
    );

    const content = readTestFile(file);
    expect(content).toContain('function a() { y; }');
    expect(content).toContain('function b() { x; }');
  });

  it('handles auto-expand for duplicates', async () => {
    const file = await writeTestFile('expand.txt', 'a\nb\nc\nb\nd\n');
    const tool = createTool();
    await tool.execute(
      '4',
      { path: file, edits: [{ oldText: 'b', newText: 'x' }] },
      undefined,
      undefined,
      undefined,
    );

    const content = readTestFile(file);
    expect(content.split('\n').filter((l) => l === 'x')).toHaveLength(1);
    expect(content.split('\n').filter((l) => l === 'b')).toHaveLength(1);
  });

  it('preserves BOM when present', async () => {
    const file = await writeTestFile('bom.txt', '\uFEFFa\nb\nc\n');
    const tool = createTool();
    await tool.execute(
      '5',
      { path: file, edits: [{ oldText: 'b', newText: 'x' }] },
      undefined,
      undefined,
      undefined,
    );

    const content = readTestFile(file);
    expect(content).toBe('\uFEFFa\nx\nc\n');
  });

  it('preserves CRLF line endings', async () => {
    const file = await writeTestFile('crlf.txt', 'a\r\nb\r\nc\r\n');
    const tool = createTool();
    await tool.execute(
      '6',
      { path: file, edits: [{ oldText: 'b', newText: 'x' }] },
      undefined,
      undefined,
      undefined,
    );

    const content = readTestFile(file);
    expect(content).toBe('a\r\nx\r\nc\r\n');
  });

  it('applies multiple edits in one call', async () => {
    const file = await writeTestFile('multi.txt', 'a\nb\nc\nd\n');
    const tool = createTool();
    await tool.execute(
      '7',
      {
        path: file,
        edits: [
          { oldText: 'a', newText: 'x' },
          { oldText: 'd', newText: 'y' },
        ],
      },
      undefined,
      undefined,
      undefined,
    );

    expect(readTestFile(file)).toBe('x\nb\nc\ny\n');
  });

  it('returns diff details on success', async () => {
    const file = await writeTestFile('diff.txt', 'a\nb\nc\n');
    const tool = createTool();
    const result = await tool.execute(
      '8',
      { path: file, edits: [{ oldText: 'b', newText: 'x' }] },
      undefined,
      undefined,
      undefined,
    );

    expect(result.details).toBeDefined();
    expect(result.details!.diff).toBeTruthy();
    expect(result.details!.patch).toBeTruthy();
    expect(result.details!.firstChangedLine).toBeDefined();
  });

  it('fails with an error when file does not exist', async () => {
    const tool = createTool();
    try {
      await tool.execute(
        '9',
        { path: 'nonexistent.txt', edits: [{ oldText: 'a', newText: 'x' }] },
        undefined,
        undefined,
        undefined,
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain('Could not edit file');
      expect(message).toContain('ENOENT');
    }
  });

  it('fails with an error when oldText is not found', async () => {
    const file = await writeTestFile('missing.txt', 'a\nb\nc\n');
    const tool = createTool();
    try {
      await tool.execute(
        '10',
        { path: file, edits: [{ oldText: 'z', newText: 'x' }] },
        undefined,
        undefined,
        undefined,
      );
      expect(true).toBe(false);
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain('Could not apply');
      expect(message).toContain('Could not find');
    }
  });

  it('handles empty edits array', async () => {
    const file = await writeTestFile('empty.txt', 'a\nb\nc\n');
    const tool = createTool();
    const result = await tool.execute(
      '11',
      { path: file, edits: [] },
      undefined,
      undefined,
      undefined,
    );

    expect(result.content[0].text).toContain('Applied 0 edit(s)');
    expect(readTestFile(file)).toBe('a\nb\nc\n');
  });

  it('fails when signal is pre-aborted', async () => {
    const file = await writeTestFile('abort.txt', 'a\nb\nc\n');
    const tool = createTool();
    const controller = new AbortController();
    controller.abort();

    try {
      await tool.execute(
        '12',
        { path: file, edits: [{ oldText: 'b', newText: 'x' }] },
        controller.signal,
        undefined,
        undefined,
      );
      expect(true).toBe(false);
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain('aborted');
    }
  });
});
