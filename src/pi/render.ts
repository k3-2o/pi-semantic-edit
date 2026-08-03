/* eslint-disable @typescript-eslint/no-explicit-any */
// --- TUI rendering — mirrors Pi's built-in edit rendering ---

import { readFile, access as fsAccess } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { Box, Container, getCapabilities, hyperlink, Spacer, Text } from '@earendil-works/pi-tui';
import { renderDiff, generateDiffString } from '@earendil-works/pi-coding-agent';
import { applyBlocks } from '../domain/editor';
import { resolveToCwd, stripBom } from '../domain/utils';
import { normalizeEditArgs } from './normalize';

export interface EditPreview {
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

function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return null;
}

function linkPath(styledText: string, rawPath: string | null, cwd: string): string {
  if (!getCapabilities().hyperlinks || !rawPath) return styledText;
  const absPath = resolve(cwd, rawPath);
  return hyperlink(
    styledText,
    absPath.startsWith('/') ? `file://${absPath}` : `file://${resolve(cwd, absPath)}`,
  );
}

function firstPatchPath(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const args = input as Record<string, unknown>;
  if (typeof args.patch === 'string') {
    const reqs = normalizeEditArgs(args);
    return reqs?.[0]?.path || null;
  }
  return typeof args.path === 'string' ? args.path : null;
}

function renderToolPath(rawPath: string | null, theme: any, cwd: string): string {
  if (rawPath === null) return '...';
  const value = str(rawPath);
  const home = homedir();
  const shortened =
    value && value.startsWith(home) ? `~${value.slice(home.length)}` : value || '...';
  return linkPath(theme.fg('accent', shortened), value, cwd);
}

function formatEditCall(args: any, theme: any, cwd: string): string {
  const pathDisplay = renderToolPath(firstPatchPath(args), theme, cwd);
  return `${theme.fg('toolTitle', theme.bold('edit'))} ${pathDisplay}`;
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

function getRenderablePreviewInput(args: any): unknown {
  if (!args || typeof args !== 'object') return null;
  const reqs = normalizeEditArgs(args);
  if (!reqs || reqs.length === 0) return null;
  return args;
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
    return renderDiff(resultDiff, {
      filePath: firstPatchPath(args) ?? undefined,
    });
  return undefined;
}

export function createEditRenderers() {
  return {
    renderCall(args: any, theme: any, context: any) {
      const component = getEditCallRenderComponent(context.state, context.lastComponent);
      const previewInput = getRenderablePreviewInput(args);
      const argsKey = previewInput ? JSON.stringify(previewInput) : undefined;

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
      const argsKey = previewInput ? JSON.stringify(previewInput) : undefined;

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

// --- Preview computation (async, mirrors built-in) ---

async function computePreviewDiff(input: unknown, cwd: string): Promise<EditPreview> {
  try {
    const reqs = normalizeEditArgs(input);
    if (!reqs || reqs.length === 0) {
      return { error: 'No edits found. Provide path and edits[] with oldText/newText pairs.' };
    }
    const first = reqs[0];
    if (!first.path) return { error: 'Each edit must specify a path.' };
    // --- Resolve like the tool (session cwd, ~ expansion) so preview and apply agree ---
    const absolutePath = resolveToCwd(first.path, cwd);
    await fsAccess(absolutePath, constants.R_OK);
    const rawContent = await readFile(absolutePath, 'utf-8');
    const { text: content } = stripBom(rawContent);
    const result = applyBlocks(content, reqs, first.path);
    if (!result.ok || result.content === undefined) {
      return { error: result.error?.message ?? 'Edit could not be applied.' };
    }
    const { diff, firstChangedLine } = generateDiffString(content, result.content);
    return { diff, firstChangedLine };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}
