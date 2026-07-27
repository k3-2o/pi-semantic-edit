import { constants } from 'fs';
import { access as fsAccess, readFile } from 'fs/promises';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { applyEdits } from './matcher';
import type { Edit } from './matcher';
import {
  detectLineEnding,
  restoreLineEndings,
  stripBom,
  generateDiff,
  generateUnifiedPatch,
} from './utils';
import { resolveToCwd } from './path-utils';

const replaceEditSchema = Type.Object({
  oldText: Type.String({ description: 'The old text to find in the file. Must be unique.' }),
  newText: Type.String({ description: 'The replacement text.' }),
  anchor: Type.Optional(
    Type.String({ description: 'Optional nearby unique snippet to narrow the search region.' }),
  ),
});

const editSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to edit (relative or absolute).' }),
  edits: Type.Array(replaceEditSchema, {
    description:
      'One or more targeted replacements. Each edit is matched against the original file, not incrementally. ' +
      'If two changes affect nearby lines, merge them into one edit. Keep edits as small as possible while unique.',
  }),
});

/** Creates the `edit_robust` Pi tool definition. */
export function createRobustEditTool(cwd: string, _pi: ExtensionAPI) {
  return {
    name: 'edit_robust',
    label: 'edit_robust',
    description:
      'Edit a file by providing old and new code blocks. The tool handles locating the correct ' +
      'position, disambiguating duplicates, and applying the change safely. Optionally provide an ' +
      '"anchor" — a nearby unique snippet — to narrow the search.',
    parameters: editSchema,
    renderShell: 'self' as const,

    async execute(
      _toolCallId: string,
      input: { path: string; edits: Edit[] },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const path = input.path;
      const absolutePath = resolveToCwd(path, cwd);

      return await withFileMutationQueue(absolutePath, async () => {
        const throwIfAborted = () => {
          if (signal?.aborted) throw new Error('Operation aborted');
        };

        throwIfAborted();

        // Check file access
        try {
          await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
        } catch (err: unknown) {
          throwIfAborted();
          const code =
            err && typeof err === 'object' && 'code' in err ? `${err.code}` : String(err);
          throw new Error(`Could not edit file: ${path}. Error code: ${code}.`);
        }

        throwIfAborted();

        // Read the file
        const buffer = await readFile(absolutePath);
        const rawContent = buffer.toString('utf-8');
        throwIfAborted();

        // Strip BOM, detect line endings
        const { bom, text: bomStripped } = stripBom(rawContent);
        const originalEnding = detectLineEnding(bomStripped);

        // Apply edits against LF-normalized content
        const result = applyEdits(bomStripped, input.edits);

        if (result.failed.length > 0 && result.matches.length === 0) {
          throw new Error(
            `Could not apply ${result.failed.length} edit(s) to "${path}".\n` +
              result.failed.map((f) => `  - ${f.reason}`).join('\n'),
          );
        }

        throwIfAborted();

        // Write the file
        const finalContent = bom + restoreLineEndings(result.newContent, originalEnding);
        // writeFile from fs/promises used via Pi's mutation queue
        const { writeFile } = await import('fs/promises');
        await writeFile(absolutePath, finalContent, 'utf-8');

        throwIfAborted();

        // Generate diff
        const diffResult = generateDiff(bomStripped, result.newContent);
        const patch = generateUnifiedPatch(path, bomStripped, result.newContent);

        const text: string[] = [`Applied ${result.matches.length} edit(s) to "${path}".`];
        if (result.failed.length > 0) {
          text.push(`${result.failed.length} edit(s) failed:`);
          result.failed.forEach((f) => text.push(`  - ${f.reason}`));
        }

        return {
          content: [{ type: 'text' as const, text: text.join('\n') }],
          details: {
            diff: diffResult.diff ?? '',
            patch,
            firstChangedLine: diffResult.firstChangedLine ?? 0,
          },
        };
      });
    },
  };
}
