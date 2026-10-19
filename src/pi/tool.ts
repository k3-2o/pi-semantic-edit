/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from 'node:crypto';
import { constants } from 'fs';
import { access as fsAccess, readFile, rename, stat, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import {
  generateDiffString,
  generateUnifiedPatch,
  withFileMutationQueue,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import type { EditError } from '../domain/types';
import { applyBlocks } from '../domain/editor';
import { coherenceCheck } from '../domain/coherence';
import {
  fileNotFoundError,
  malformedPatchError,
  missingPathError,
  staleReadError,
  validationError,
} from '../domain/errors';
import { MalformedPatchError } from '../domain/parser';
import {
  detectLineEnding,
  normalizeNewlines,
  resolveToCwd,
  restoreLineEndings,
  stripBom,
} from '../domain/utils';
import { editToolSchema, type EditToolInput } from './schema';
import { normalizeEditArgs, type EditRequestLike } from './normalize';
import { createEditRenderers } from './render';
import { checkStaleGuard, MAX_SNAPSHOT_CHARS, normalizeSnapshot, ReadTracker } from './staleness';

function toolError(error: EditError): Error {
  return Object.assign(new Error(error.message), { editError: error });
}

interface FileGroup {
  path: string;
  blocks: EditRequestLike[];
}

function groupByPath(blocks: EditRequestLike[]): FileGroup[] {
  const groups: FileGroup[] = [];
  const index = new Map<string, number>();
  for (const block of blocks) {
    const existing = index.get(block.path);
    if (existing !== undefined) {
      groups[existing].blocks.push(block);
    } else {
      index.set(block.path, groups.length);
      groups.push({ path: block.path, blocks: [block] });
    }
  }
  return groups;
}

function subscribeToToolResults(pi: ExtensionAPI, baseCwd: string, tracker: ReadTracker): void {
  const anyPi = pi as unknown as {
    on?: (ev: string, h: (e: unknown, ctx: unknown) => void) => unknown;
    events?: { on?: (ev: string, h: (e: unknown, ctx: unknown) => void) => unknown };
  };
  const register =
    (typeof anyPi?.on === 'function' && anyPi.on.bind(anyPi)) ||
    (typeof anyPi?.events?.on === 'function' && anyPi.events.on.bind(anyPi.events));
  if (!register) return;

  register('tool_result', async (event: unknown, ctx: unknown) => {
    try {
      const payload = (event ?? {}) as Record<string, unknown>;
      if (payload.isError === true) return;
      const input = (payload.input ?? {}) as Record<string, unknown>;
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? baseCwd;
      const pathArg = pickPathArg(input);
      if (!pathArg) return;
      const absolute = resolveToCwd(pathArg, cwd);
      if (toolName === 'write' && typeof input.content === 'string') {
        tracker.record(absolute, {
          content: normalizeSnapshot(input.content),
          size: Buffer.byteLength(String(input.content)),
          mtimeMs: Date.now(),
        });
        return;
      }
      if (toolName === 'read' || toolName === 'edit') {
        await recordFromDisk(absolute, tracker);
      }
    } catch {
      // --- Never break the event stream over an untrackable result ---
    }
  });
}

function pickPathArg(input: Record<string, unknown>): string | null {
  const raw = input.path ?? input.fileName ?? input.file;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

async function recordFromDisk(absolute: string, tracker: ReadTracker): Promise<void> {
  const st = await stat(absolute);
  if (st.size > MAX_SNAPSHOT_CHARS) {
    tracker.record(absolute, { content: null, size: st.size, mtimeMs: st.mtimeMs });
    return;
  }
  const raw = await readFile(absolute, 'utf-8');
  tracker.record(absolute, {
    content: normalizeSnapshot(raw),
    size: st.size,
    mtimeMs: st.mtimeMs,
  });
}

function excerptOf(content: string, changedLines?: [number, number]): string | undefined {
  if (!changedLines) return undefined;
  const lines = content.split('\n');
  const [first, last] = [changedLines[0], Math.min(changedLines[1], changedLines[0] + 1)];
  const parts: string[] = [];
  for (let i = first - 1; i < last && i < lines.length; i++) {
    const ln = lines[i];
    parts.push(ln.length > 80 ? ln.slice(0, 80) + '…' : ln);
  }
  return parts.join(' / ');
}

export function createRobustEditTool(cwd: string, pi: ExtensionAPI) {
  const renderers = createEditRenderers();
  const tracker = new ReadTracker();
  subscribeToToolResults(pi, cwd, tracker);

  return {
    name: 'edit',
    label: 'edit',

    description:
      'Edit a file via exact text replacement. oldText must be a unique, non-overlapping region of ' +
      'the original file; merge nearby changes into one edit; no large unchanged padding.',
    promptSnippet: 'Edit files with exact text replacement; batch several edits into one call',
    promptGuidelines: [
      'Use edit for precise changes; oldText must match exactly',
      'Several separate changes in one file: one call, multiple edits[] entries',
      'edits[] match the original file; no overlapping or nested edits; merge nearby changes into one edit',
      'oldText: smallest unique span; no large unchanged padding',

      'replaceAll: true replaces every occurrence (renames)',
    ],
    parameters: editToolSchema,
    constrainedSampling: { type: 'json_schema', strict: 'prefer' } as const,
    renderShell: 'self' as const,

    prepareArguments(input: any) {
      if (!input || typeof input !== 'object') return input;
      let reqs: EditRequestLike[] | null;
      try {
        reqs = normalizeEditArgs(input);
      } catch (err) {
        if (err instanceof MalformedPatchError) return input;
        throw err;
      }
      if (typeof input.patch === 'string') {
        return reqs ? { path: reqs[0]?.path ?? '', edits: reqs } : input;
      }
      if (reqs) {
        const first = reqs[0];
        return { path: first?.path ?? '', edits: reqs };
      }
      return input;
    },

    async execute(
      _toolCallId: string,
      input: EditToolInput,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd?: string } | undefined,
    ) {
      const throwIfAborted = () => {
        if (signal?.aborted) throw new Error('Operation aborted');
      };

      const baseCwd = ctx?.cwd ?? cwd;

      let blocks: EditRequestLike[] | null;
      try {
        blocks = normalizeEditArgs(input);
      } catch (err) {
        if (err instanceof MalformedPatchError) {
          throw toolError(malformedPatchError(err.message, err.index));
        }
        throw err;
      }
      if (!blocks || blocks.length === 0) {
        const raw = input as unknown as Record<string, unknown>;
        const stringEdits = typeof raw.edits === 'string';
        throw toolError(
          validationError(
            stringEdits
              ? 'edits is a JSON string that did not parse. Provide edits[] as an array of {oldText, newText} objects.'
              : 'No edits found. Provide edits[] with oldText/newText pairs.',
          ),
        );
      }
      if (blocks.some((b) => !b.path)) {
        throw toolError(missingPathError());
      }

      const summaries: string[] = [];
      const matchPasses: string[] = [];
      let primaryDiff = '';
      let primaryPatch = '';
      let primaryFirstChangedLine = 0;

      for (const group of groupByPath(blocks)) {
        const absolutePath = resolveToCwd(group.path, baseCwd);
        throwIfAborted();

        const fileResult = await withFileMutationQueue(absolutePath, async () => {
          throwIfAborted();
          try {
            await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
          } catch (err) {
            const code =
              err && typeof err === 'object' && 'code' in err
                ? `${(err as { code?: unknown }).code}`
                : String(err);
            throw toolError(fileNotFoundError(`${group.path} (${code})`));
          }

          let statInfo: { size: number; mtimeMs: number } | undefined;
          try {
            const st = await stat(absolutePath);
            statInfo = { size: st.size, mtimeMs: st.mtimeMs };
          } catch {
            statInfo = undefined;
          }

          throwIfAborted();
          let buffer: Buffer;
          try {
            buffer = await readFile(absolutePath);
          } catch (err) {
            const code =
              err && typeof err === 'object' && 'code' in err
                ? `${(err as { code?: unknown }).code}`
                : String(err);
            throw toolError(
              validationError(
                `Could not read ${group.path} (${code}) — file changed or removed. ` +
                  'Re-read and retry.',
              ),
            );
          }
          const rawContent = buffer.toString('utf-8');
          const { bom, text } = stripBom(rawContent);
          const ending = detectLineEnding(text);

          const content = normalizeNewlines(text);

          const result = applyBlocks(content, group.blocks, group.path);
          if (!result.ok || result.content === undefined) throw toolError(result.error!);

          const guard = checkStaleGuard({
            tracker,
            path: absolutePath,
            matchPasses: result.matchPasses,
            spans: result.spans,
            currentContent: content,
            currentSize: statInfo?.size ?? 0,
            currentMtimeMs: statInfo?.mtimeMs ?? 0,
          });
          if (guard.stale) {
            throw toolError(
              staleReadError(
                group.path,
                guard.changedLines,
                excerptOf(content, guard.changedLines),
              ),
            );
          }

          const warnings = coherenceCheck(result.content);

          const finalContent = bom + restoreLineEndings(result.content, ending);

          const tmpPath = resolve(dirname(absolutePath), `.${randomUUID()}.tmp`);
          await writeFile(tmpPath, finalContent, 'utf-8');
          await rename(tmpPath, absolutePath);

          const diffResult = generateDiffString(content, result.content);
          return {
            appliedCount: group.blocks.length,
            replacements: result.replacements,
            matchPasses: result.matchPasses,
            diff: diffResult.diff ?? '',
            firstChangedLine: diffResult.firstChangedLine ?? 0,
            patch: generateUnifiedPatch(group.path, content, result.content),
            warnings,
          };
        });

        // --- Render parity with pi's built-in: 'Successfully replaced N block(s) in path.' ---
        summaries.push(`Successfully replaced ${group.blocks.length} block(s) in ${group.path}.`);
        if (fileResult.warnings.length > 0) {
          summaries.push('Coherence warnings:');
          for (const w of fileResult.warnings) summaries.push(`  - ${w}`);
        }
        matchPasses.push(...fileResult.matchPasses);
        if (!primaryDiff) {
          primaryDiff = fileResult.diff;
          primaryPatch = fileResult.patch;
          primaryFirstChangedLine = fileResult.firstChangedLine;
        }
      }

      const text = summaries.join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        details: {
          diff: primaryDiff,
          patch: primaryPatch,
          firstChangedLine: primaryFirstChangedLine,
          matchPasses,
        },
      };
    },

    ...renderers,
  };
}
