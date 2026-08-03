/* eslint-disable @typescript-eslint/no-explicit-any */
// --- Pi adapter — schema, execute orchestration, error wiring; heavy logic lives in the domain layer ---

import { randomUUID } from 'node:crypto';
import { constants } from 'fs';
import { access as fsAccess, readFile, rename, writeFile } from 'fs/promises';
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
import { fileNotFoundError, validationError } from '../domain/errors';
import type { ReadRegistry } from '../domain/stale-read';
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

// --- Throw an Error carrying a structured EditError (for renderers/debugging) ---
function toolError(error: EditError): Error {
  return Object.assign(new Error(error.message), { editError: error });
}

interface FileGroup {
  path: string;
  blocks: EditRequestLike[];
}

// --- Group requests by path, preserving first-seen order ---
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

// --- Creates the `edit` tool — shadows Pi's built-in (SPEC D1) ---
export function createRobustEditTool(cwd: string, _pi: ExtensionAPI, registry: ReadRegistry) {
  const renderers = createEditRenderers();

  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a file by providing exact text replacements (edits[]), each with oldText and newText. ' +
      'The matcher tolerates whitespace, indentation, escape, and formatting drift ' +
      'between the oldText and the actual file content (10-pass fuzzy chain). ' +
      'If the text matches multiple locations, the edit fails with the line ' +
      'positions and asks for more context — it never guesses. Set replaceAll: true ' +
      'on an edit to replace every occurrence (e.g. renaming a variable). Format:\n' +
      '{ "path": "src/foo.ts", "edits": [{ "oldText": "let x = 1;", "newText": "let x = 2;" }] }',
    promptSnippet:
      'Make precise file edits with exact text replacement, including multiple disjoint edits in one call — set replaceAll: true to replace every occurrence (e.g. renames)',
    promptGuidelines: [
      'Use edit for precise changes (edits[].oldText must match the current file content, modulo tolerated drift).',
      'When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls.',
      'Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.',
      'Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.',
      'The matcher tolerates minor whitespace, indentation, line-ending, escape, and Unicode drift — but copy the code as accurately as you can.',
      'If the text matches multiple locations, the edit fails with the line positions — include more surrounding context, or set replaceAll: true to replace every occurrence. If nothing matches, the error shows the closest text actually in the file; correct against that and retry.',
    ],
    parameters: editToolSchema,
    renderShell: 'self' as const,

    prepareArguments(input: any) {
      if (!input || typeof input !== 'object') return input;
      if (typeof input.patch === 'string') {
        // --- Deprecated aider input — normalize here too so execute stays uniform ---
        const reqs = normalizeEditArgs(input);
        return reqs ? { path: reqs[0]?.path ?? '', edits: reqs } : input;
      }
      const reqs = normalizeEditArgs(input);
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

      // --- Resolve against the SESSION cwd, not the extension-load cwd — they differ when pi is launched elsewhere ---
      const baseCwd = ctx?.cwd ?? cwd;

      const blocks = normalizeEditArgs(input);
      if (!blocks || blocks.length === 0) {
        throw toolError(
          validationError('No edits found. Provide path and edits[] with oldText/newText pairs.'),
        );
      }
      if (blocks.some((b) => !b.path)) {
        throw toolError(validationError('Each edit must specify a path.'));
      }

      const summaries: string[] = [];
      const matchPasses: string[] = [];
      let primaryDiff = '';
      let primaryPatch = '';
      let primaryFirstChangedLine = 0;

      for (const group of groupByPath(blocks)) {
        const absolutePath = resolveToCwd(group.path, baseCwd);
        throwIfAborted();

        const stale = registry.assertFresh(absolutePath);
        if (stale) throw toolError(stale);

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

          throwIfAborted();
          let buffer: Buffer;
          try {
            buffer = await readFile(absolutePath);
          } catch (err) {
            // --- File vanished or became unreadable after access — re-read is the fix ---
            const code =
              err && typeof err === 'object' && 'code' in err
                ? `${(err as { code?: unknown }).code}`
                : String(err);
            throw toolError(
              validationError(
                `Could not read ${group.path} (${code}) — the file may have changed or been removed. ` +
                  'Re-read the file and retry the edit.',
              ),
            );
          }
          const rawContent = buffer.toString('utf-8');
          const { bom, text } = stripBom(rawContent);
          const ending = detectLineEnding(text);
          // --- CRLF pitfall: match AND apply on LF-normalized content, restore original endings on write ---
          const content = normalizeNewlines(text);

          const result = applyBlocks(content, group.blocks, group.path);
          if (!result.ok || result.content === undefined) throw toolError(result.error!);

          const warnings = coherenceCheck(result.content);

          const finalContent = bom + restoreLineEndings(result.content, ending);

          // --- Atomic write: temp file + rename (same directory) ---
          const tmpPath = resolve(dirname(absolutePath), `.${randomUUID()}.tmp`);
          await writeFile(tmpPath, finalContent, 'utf-8');
          await rename(tmpPath, absolutePath);

          // --- Our edit result holds the new file state — model's knowledge is fresh ---
          registry.selfRefresh(absolutePath);

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

        const replacementWord = fileResult.replacements === 1 ? 'replacement' : 'replacements';
        summaries.push(
          `Successfully replaced ${fileResult.replacements} ${replacementWord} across ` +
            `${fileResult.appliedCount} edit(s) in ${group.path}.`,
        );
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

      const text = [summaries.join('\n')];
      const nonSimple = matchPasses.filter((p) => p !== 'simple');
      if (nonSimple.length > 0) {
        text.push(`Match passes: ${nonSimple.join(', ')}`);
      }

      return {
        content: [{ type: 'text' as const, text: text.join('\n') }],
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
