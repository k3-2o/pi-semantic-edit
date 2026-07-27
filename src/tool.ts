/* eslint-disable @typescript-eslint/no-explicit-any */

import { constants } from 'fs';
import { access as fsAccess, readFile } from 'fs/promises';
import { homedir } from 'os';
import { resolve } from 'path';
import { Type } from 'typebox';
import { Box, Container, getCapabilities, hyperlink, Spacer, Text } from '@earendil-works/pi-tui';
import {
  renderDiff,
  withFileMutationQueue,
  generateDiffString,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { applyEdits, parseSearchReplaceBlocks } from './matcher';
import type { Edit } from './matcher';
import { detectLineEnding, restoreLineEndings, stripBom, generateUnifiedPatch } from './utils';

// ---- Schema (matches Pi's built-in edit schema exactly) ---- //

const replaceEditSchema = Type.Object({
  oldText: Type.String({
    description:
      'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
  }),
  newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
  anchor: Type.Optional(
    Type.String({ description: 'Optional nearby unique snippet to narrow the search region.' }),
  ),
});

const editSchema = Type.Object({
  path: Type.Optional(
    Type.String({
      description:
        'Path to the file to edit (relative or absolute). Required if not using patch field.',
    }),
  ),
  edits: Type.Optional(
    Type.Array(replaceEditSchema, {
      description:
        'One or more targeted replacements. Each edit is matched against the original file, not incrementally. ' +
        'Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
    }),
  ),
  patch: Type.Optional(
    Type.String({
      description:
        'Alternative to edits: a SEARCH/REPLACE block string in the format ' +
        '[filename]\\n<<<<<<< SEARCH\\nold code\\n=======\\nnew code\\n>>>>>>> REPLACE',
    }),
  ),
});

// ---- Helpers to match Pi's rendering ---- //

function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return null;
}

function renderToolPath(rawPath: string | null, theme: any, cwd: string): string {
  if (rawPath === null) return '...';
  const value = str(rawPath);
  const home = homedir();
  const shortened =
    value && value.startsWith(home) ? `~${value.slice(home.length)}` : value || '...';
  return linkPath(theme.fg('accent', shortened), value, cwd);
}

function linkPath(styledText: string, rawPath: string | null, cwd: string): string {
  if (!getCapabilities().hyperlinks || !rawPath) return styledText;
  const absPath = resolve(cwd, rawPath);
  return hyperlink(
    styledText,
    absPath.startsWith('/') ? `file://${absPath}` : `file://${resolve(cwd, absPath)}`,
  );
}

function formatEditCall(args: any, theme: any, cwd: string): string {
  const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
  return `${theme.fg('toolTitle', theme.bold('edit'))} ${pathDisplay}`;
}

// ---- Rendering components (mirrors Pi's built-in edit) ---- //

interface EditPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

interface EditCallComponent extends Box {
  preview?: EditPreview;
  previewArgsKey?: string;
  previewPending?: boolean;
  settledError?: boolean;
}

function createEditCallRenderComponent(): EditCallComponent {
  return Object.assign(new Box(1, 1, (text: string) => text), {
    preview: undefined,
    previewArgsKey: undefined,
    previewPending: false,
    settledError: false,
  });
}

function getEditCallRenderComponent(state: any, lastComponent: any): EditCallComponent {
  if (lastComponent instanceof Box) {
    state.callComponent = lastComponent;
    return lastComponent;
  }
  if (state.callComponent) return state.callComponent;
  const component = createEditCallRenderComponent();
  state.callComponent = component;
  return component;
}

function getRenderablePreviewInput(args: any) {
  if (!args) return null;
  const path =
    typeof args.path === 'string'
      ? args.path
      : typeof args.file_path === 'string'
        ? args.file_path
        : null;
  if (!path) return null;
  if (
    Array.isArray(args.edits) &&
    args.edits.length > 0 &&
    args.edits.every((e: any) => typeof e?.oldText === 'string' && typeof e?.newText === 'string')
  ) {
    return { path, edits: args.edits };
  }
  if (typeof args.patch === 'string') return { path, patch: args.patch };
  return null;
}

function setEditPreview(
  component: EditCallComponent,
  preview: EditPreview,
  argsKey: string | undefined,
): boolean {
  const current = component.preview;
  const changed =
    current === undefined ||
    ('error' in current && 'error' in preview
      ? current.error !== preview.error
      : 'error' in current !== 'error' in preview) ||
    (!('error' in current) &&
      !('error' in preview) &&
      (current.diff !== preview.diff || current.firstChangedLine !== preview.firstChangedLine));
  component.preview = preview;
  component.previewArgsKey = argsKey;
  component.previewPending = false;
  return changed;
}

function getEditHeaderBg(
  preview: EditPreview | undefined,
  settledError: boolean | undefined,
  theme: any,
) {
  if (preview) {
    if ('error' in preview) return (text: string) => theme.bg('toolErrorBg', text);
    return (text: string) => theme.bg('toolSuccessBg', text);
  }
  if (settledError) return (text: string) => theme.bg('toolErrorBg', text);
  return (text: string) => theme.bg('toolPendingBg', text);
}

function buildEditCallComponent(component: EditCallComponent, args: any, theme: any, cwd: string) {
  component.setBgFn(getEditHeaderBg(component.preview, component.settledError, theme));
  component.clear();
  component.addChild(new Text(formatEditCall(args, theme, cwd), 0, 0));
  if (!component.preview) return component;
  const body =
    'error' in component.preview
      ? theme.fg('error', component.preview.error)
      : renderDiff(component.preview.diff ?? '');
  component.addChild(new Spacer(1));
  component.addChild(new Text(body, 0, 0));
  return component;
}

function formatEditResult(
  args: any,
  preview: EditPreview | undefined,
  result: any,
  theme: any,
  isError: boolean,
): string | undefined {
  if (isError) {
    const errorText = result.content
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text || '')
      .join('\n');
    if (!errorText || errorText === preview?.error) return undefined;
    return theme.fg('error', errorText);
  }
  const resultDiff = result.details?.diff;
  if (resultDiff && resultDiff !== preview?.diff)
    return renderDiff(resultDiff, { filePath: str(args?.file_path ?? args?.path) ?? undefined });
  return undefined;
}

// ---- Input handling (edits[] or patch) ---- //

function resolveEdits(input: any): { edits: Edit[]; path: string } {
  if (input.patch) {
    const parsed = parseSearchReplaceBlocks(input.patch);
    if (parsed.length === 0) throw new Error('No valid SEARCH/REPLACE blocks found in patch.');
    const edits: Edit[] = parsed.map((block) => ({
      oldText: block.oldText,
      newText: block.newText,
      anchor: undefined,
    }));
    return { edits, path: parsed[0].path || input.path || '' };
  }
  if (Array.isArray(input.edits) && input.edits.length > 0) {
    return { edits: input.edits, path: input.path || '' };
  }
  throw new Error('Edit tool input is invalid. edits must contain at least one replacement.');
}

// ---- Tool creation ---- //

/** Creates the `edit` tool definition that visually replaces Pi's built-in edit tool. */
export function createRobustEditTool(cwd: string, _pi: ExtensionAPI) {
  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a file by providing old and new code blocks (or a SEARCH/REPLACE patch). ' +
      'The tool handles whitespace drift, duplicate disambiguation, anchors, and structural checks. ' +
      'If oldText appears in multiple places, add an "anchor" field with a nearby unique snippet, ' +
      'or provide a SEARCH/REPLACE block with enough context to uniquely identify the location.',
    promptSnippet:
      'Edit files using old/new code blocks or SEARCH/REPLACE patches with anchor support',
    promptGuidelines: [
      'Use edit for file changes. Provide the old code and the new code — the tool handles minor whitespace and line-ending differences.',
      'For targeted changes, include an "anchor" field with a nearby unique snippet (function name, unique comment) to narrow the search.',
      'Alternatively, use a SEARCH/REPLACE block in the "patch" field: [filename]\\n<<<<<<< SEARCH\\nold code\\n=======\\nnew code\\n>>>>>>> REPLACE',
      'If oldText matches multiple locations, add more context or an anchor. The tool will try to disambiguate, but may ask for help.',
      'The tool checks for structural integrity (balanced braces, indentation) after editing and warns if something looks wrong.',
      'Keep oldText as short as possible while still being unique. Do not pad with large unchanged regions.',
    ],
    parameters: editSchema,
    renderShell: 'self' as const,

    prepareArguments(input: any) {
      if (!input || typeof input !== 'object') return input;
      const args = input;
      if (typeof args.edits === 'string') {
        try {
          const parsed = JSON.parse(args.edits);
          if (Array.isArray(parsed)) args.edits = parsed;
        } catch {
          /* empty */
        }
      }
      if (typeof args.oldText === 'string' || typeof args.newText === 'string') {
        const edits = Array.isArray(args.edits) ? [...args.edits] : [];
        edits.push({ oldText: args.oldText, newText: args.newText });
        const { oldText: _o, newText: _n, ...rest } = args;
        void _o;
        void _n;
        return { ...rest, edits };
      }
      return args;
    },

    async execute(
      _toolCallId: string,
      input: any,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: unknown,
    ) {
      const { edits, path } = resolveEdits(input);
      const absolutePath = resolveToCwd(path, cwd);

      return await withFileMutationQueue(absolutePath, async () => {
        const throwIfAborted = () => {
          if (signal?.aborted) throw new Error('Operation aborted');
        };
        throwIfAborted();

        try {
          await fsAccess(absolutePath, constants.R_OK | constants.W_OK);
        } catch (err: unknown) {
          throwIfAborted();
          const code =
            err && typeof err === 'object' && 'code' in err ? `${(err as any).code}` : String(err);
          throw new Error(`Could not edit file: ${path}. ${code}.`);
        }

        throwIfAborted();
        const buffer = await readFile(absolutePath);
        const rawContent = buffer.toString('utf-8');
        throwIfAborted();

        const { bom, text: bomStripped } = stripBom(rawContent);
        const originalEnding = detectLineEnding(bomStripped);

        const result = applyEdits(bomStripped, edits);

        if (result.failed.length > 0 && result.matches.length === 0) {
          throw new Error(
            `Could not apply ${result.failed.length} edit(s) to "${path}".\n` +
              result.failed.map((f) => `  - ${f.reason}`).join('\n'),
          );
        }

        throwIfAborted();
        const finalContent = bom + restoreLineEndings(result.newContent, originalEnding);
        const { writeFile } = await import('fs/promises');
        await writeFile(absolutePath, finalContent, 'utf-8');
        throwIfAborted();

        const diffResult = generateDiffString(bomStripped, result.newContent);
        const patch = generateUnifiedPatch(path, bomStripped, result.newContent);

        const text: string[] = [
          `Successfully replaced ${result.matches.length} block(s) in ${path}.`,
        ];
        if (result.failed.length > 0) {
          text.push(`${result.failed.length} edit(s) failed:`);
          result.failed.forEach((f) => text.push(`  - ${f.reason}`));
        }
        if (result.warnings && result.warnings.length > 0) {
          text.push('Coherence warnings:');
          result.warnings.forEach((w) => text.push(`  - ${w}`));
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

    renderCall(args: any, theme: any, context: any) {
      const component = getEditCallRenderComponent(context.state, context.lastComponent);
      const previewInput = getRenderablePreviewInput(args);
      const argsKey = previewInput
        ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits })
        : undefined;

      if (component.previewArgsKey !== argsKey) {
        component.preview = undefined;
        component.previewArgsKey = argsKey;
        component.previewPending = false;
        component.settledError = false;
      }

      if (context.argsComplete && previewInput && !component.preview && !component.previewPending) {
        component.previewPending = true;
        const requestKey = argsKey;
        void computePreviewDiff(previewInput, context.cwd).then((preview) => {
          if (component.previewArgsKey === requestKey) {
            setEditPreview(component, preview, requestKey);
            context.invalidate();
          }
        });
      }

      return buildEditCallComponent(component, args, theme, context.cwd);
    },

    renderResult(result: any, _options: any, theme: any, context: any) {
      const callComponent = context.state.callComponent;
      const previewInput = getRenderablePreviewInput(context.args);
      const argsKey = previewInput
        ? JSON.stringify({ path: previewInput.path, edits: previewInput.edits })
        : undefined;

      if (callComponent) {
        const typedResult = result;
        const resultDiff = !context.isError ? typedResult.details?.diff : undefined;
        let changed = false;

        if (typeof resultDiff === 'string') {
          changed =
            setEditPreview(
              callComponent,
              { diff: resultDiff, firstChangedLine: typedResult.details?.firstChangedLine },
              argsKey,
            ) || changed;
        }
        if (callComponent.settledError !== context.isError) {
          callComponent.settledError = context.isError;
          changed = true;
        }
        if (changed) buildEditCallComponent(callComponent, context.args, theme, context.cwd);
      }

      const output = formatEditResult(
        context.args,
        callComponent?.preview,
        result,
        theme,
        context.isError,
      );
      const component = context.lastComponent ?? new Container();
      component.clear();
      if (!output) return component;
      component.addChild(new Spacer(1));
      component.addChild(new Text(output, 1, 0));
      return component;
    },
  };
}

// ---- Preview computation (async, mirrors built-in) ---- //

async function computePreviewDiff(input: any, cwd: string): Promise<EditPreview> {
  try {
    const { edits, path } = resolveEdits(input);
    const absolutePath = resolve(cwd, path);
    await fsAccess(absolutePath, constants.R_OK);
    const rawContent = await readFile(absolutePath, 'utf-8');
    const { text: content } = stripBom(rawContent);
    const baseContent = content;
    const result = applyEdits(baseContent, edits);
    const newContent = result.newContent;
    const diffResult = generateDiffString(baseContent, newContent);
    const { diff, firstChangedLine } = diffResult;
    return { diff, firstChangedLine };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

function resolveToCwd(userPath: string, cwd: string): string {
  return userPath.startsWith('/') || userPath.startsWith('~')
    ? userPath.replace(/^~/, homedir())
    : resolve(cwd, userPath);
}
