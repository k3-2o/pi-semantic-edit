/* eslint-disable @typescript-eslint/no-explicit-any */
// The Pi adapter tool — schema, execute orchestration, error wiring.
// All heavy logic lives in the domain layer; this file only coordinates.

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
import type { EditError, ParsedBlock } from '../domain/types';
import { applyBlocks } from '../domain/editor';
import { coherenceCheck } from '../domain/coherence';
import { MalformedPatchError, parseAiderBlocks } from '../domain/parser';
import {
  fileNotFoundError,
  malformedPatchError,
  missingPathError,
  validationError,
} from '../domain/errors';
import type { ReadRegistry } from '../domain/stale-read';
import {
  detectLineEnding,
  normalizeNewlines,
  resolveToCwd,
  restoreLineEndings,
  stripBom,
} from '../domain/utils';
import { editToolSchema } from './schema';
import { createEditRenderers } from './render';

const AIDER_FORMAT_EXAMPLE = [
  'src/foo.ts',
  '```',
  '<<<<<<< SEARCH',
  'old code (exactly as it appears in the file)',
  '=======',
  'new code',
  '>>>>>>> REPLACE',
  '```',
].join('\n');

/** Throw an Error carrying a structured EditError (for renderers/debugging). */
function toolError(error: EditError): Error {
  return Object.assign(new Error(error.message), { editError: error });
}

interface FileGroup {
  path: string;
  blocks: ParsedBlock[];
}

/** Group blocks by path, preserving first-seen order. */
function groupByPath(blocks: ParsedBlock[]): FileGroup[] {
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

/** Convert a legacy (built-in / old experiment) args shape into an aider patch. */
function legacyArgsToPatch(input: any): { patch: string } | null {
  const edits: { oldText: string; newText: string }[] = [];
  // Some models (e.g. Opus 4.6, GLM-5.1) send edits as a JSON string
  // (built-in edit handles this too — keep parity for session resume).
  if (typeof input.edits === 'string') {
    try {
      const parsed = JSON.parse(input.edits);
      if (Array.isArray(parsed)) edits.push(...parsed);
    } catch {
      /* malformed JSON — fall through */
    }
  } else if (Array.isArray(input.edits)) {
    edits.push(...input.edits);
  }
  if (typeof input.oldText === 'string' && typeof input.newText === 'string') {
    edits.push({ oldText: input.oldText, newText: input.newText });
  }
  if (edits.length === 0) return null;
  const path = typeof input.path === 'string' && input.path ? input.path : 'src';
  const patch = edits
    .map((e) => `${path}\n<<<<<<< SEARCH\n${e.oldText}\n=======\n${e.newText}\n>>>>>>> REPLACE`)
    .join('\n');
  return { patch };
}

/** Creates the `edit` tool — shadows Pi's built-in (SPEC D1). */
export function createRobustEditTool(cwd: string, _pi: ExtensionAPI, registry: ReadRegistry) {
  const renderers = createEditRenderers();

  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a file by providing a SEARCH/REPLACE patch in aider block format. ' +
      'The matcher tolerates whitespace, indentation, escape, and formatting drift ' +
      'between the SEARCH text and the actual file content (9-pass fuzzy chain). ' +
      'If the SEARCH text matches multiple locations, the edit fails with the line ' +
      'positions and asks for more context — it never guesses. Format:\n' +
      AIDER_FORMAT_EXAMPLE,
    promptSnippet:
      'Edit files using aider-format SEARCH/REPLACE blocks, including multiple blocks in one call',
    promptGuidelines: [
      'Use edit for file changes. Provide the file path on its own line, then a block: <<<<<<< SEARCH, the exact current code, =======, the replacement code, >>>>>>> REPLACE.',
      'When changing multiple separate locations in a file, use multiple blocks in one edit call instead of multiple edit calls.',
      'Each SEARCH block is matched against the original file, not after earlier blocks are applied. Do not emit overlapping or nested blocks; merge nearby changes into one block.',
      'Keep the SEARCH text as small as possible while still being unique in the file. Do not pad with large unchanged regions.',
      'The matcher tolerates minor whitespace, indentation, line-ending, escape, and Unicode drift — but copy the code as accurately as you can.',
      'If the SEARCH text matches multiple locations, the edit fails with the line positions — include more surrounding context. If nothing matches, the error shows the closest text actually in the file; correct against that and retry.',
    ],
    parameters: editToolSchema,
    renderShell: 'self' as const,

    prepareArguments(input: any) {
      if (!input || typeof input !== 'object') return input;
      if (typeof input.patch === 'string') return input;
      // Legacy session resume: old experiment emitted path/edits[]/oldText+newText.
      const converted = legacyArgsToPatch(input);
      if (converted) return converted;
      return input;
    },

    async execute(
      _toolCallId: string,
      input: { patch: string },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd?: string } | undefined,
    ) {
      const throwIfAborted = () => {
        if (signal?.aborted) throw new Error('Operation aborted');
      };

      // Resolve paths against the SESSION working directory, not the
      // extension-load cwd — they differ when pi is launched elsewhere.
      const baseCwd = ctx?.cwd ?? cwd;

      // ---- Parse + validate ----
      let blocks: ParsedBlock[];
      try {
        blocks = parseAiderBlocks(input.patch);
      } catch (err) {
        const e = err as MalformedPatchError;
        throw toolError(malformedPatchError(e.message, e.index));
      }
      if (blocks.length === 0) {
        throw toolError(validationError('No valid SEARCH/REPLACE blocks found in patch.'));
      }
      for (const b of blocks) {
        if (!b.path) throw toolError(missingPathError());
      }

      // ---- Execute per file group (fail-fast, per-file mutation queue) ----
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
            throw toolError(fileNotFoundError(`${group.path}. ${code}`));
          }

          throwIfAborted();
          const buffer = await readFile(absolutePath);
          const rawContent = buffer.toString('utf-8');
          const { bom, text } = stripBom(rawContent);
          const ending = detectLineEnding(text);
          // CRLF pitfall fix (see research README): match AND apply on
          // LF-normalized content, restore the original endings on write.
          const content = normalizeNewlines(text);

          const result = applyBlocks(content, group.blocks, group.path);
          if (!result.ok || result.content === undefined) throw toolError(result.error!);

          const warnings = coherenceCheck(result.content);

          const finalContent = bom + restoreLineEndings(result.content, ending);

          // Atomic write: temp file + rename (same directory).
          const tmpPath = resolve(dirname(absolutePath), `.${randomUUID()}.tmp`);
          await writeFile(tmpPath, finalContent, 'utf-8');
          await rename(tmpPath, absolutePath);

          // Our edit result contains the new file state → model's knowledge is fresh.
          registry.selfRefresh(absolutePath);

          const diffResult = generateDiffString(content, result.content);
          return {
            appliedCount: group.blocks.length,
            matchPasses: result.matchPasses,
            diff: diffResult.diff ?? '',
            firstChangedLine: diffResult.firstChangedLine ?? 0,
            patch: generateUnifiedPatch(group.path, content, result.content),
            warnings,
          };
        });

        summaries.push(
          `Successfully replaced ${fileResult.appliedCount} block(s) in ${group.path}.`,
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
