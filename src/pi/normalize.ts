// Input normalization — the single source of truth for turning raw tool args
// into domain EditRequest[]. Used by BOTH the tool's prepareArguments/execute
// AND the TUI preview path (render.ts), so preview and apply always agree.
//
// Accepted shapes (SPEC D1):
//   1. { path, edits: [{ oldText, newText, replaceAll? }] }   — primary contract
//   2. { path, edits: "<JSON string>" }                       — built-in legacy parity
//   3. { path, oldText, newText }                             — built-in legacy parity
//   4. { patch: "<aider blocks>" }                            — deprecated (session resume)
//
// Returns the parsed edits[] (with the path per edit), or null when nothing
// recognizable was found. Validation of emptiness happens in the domain.

import { parseAiderBlocks } from '../domain/parser';

export interface EditRequestLike {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

function toEditRequest(raw: unknown, path: string): EditRequestLike | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.oldText !== 'string' || typeof e.newText !== 'string') return null;
  return {
    path,
    oldText: e.oldText,
    newText: e.newText,
    replaceAll: e.replaceAll === true,
  };
}

function parseEditsArray(value: unknown, path: string): EditRequestLike[] {
  const result: EditRequestLike[] = [];
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const req = toEditRequest(item, path);
    if (req) result.push(req);
  }
  return result;
}

/** Parse an aider patch string into EditRequest[] (deprecated legacy input). */
function editsFromPatch(patch: string, defaultPath: string): EditRequestLike[] {
  const blocks = parseAiderBlocks(patch);
  return blocks.map((b) => ({
    path: b.path || defaultPath,
    oldText: b.oldText,
    newText: b.newText,
    replaceAll: false,
  }));
}

/**
 * Normalize raw tool args into EditRequest[].
 * Returns null when no recognizable edit input was found.
 */
export function normalizeEditArgs(input: unknown): EditRequestLike[] | null {
  if (typeof input !== 'object' || input === null) return null;
  const args = input as Record<string, unknown>;

  // 4. Deprecated aider patch input (session resume).
  if (typeof args.patch === 'string') {
    const fallbackPath = typeof args.path === 'string' ? args.path : '';
    return editsFromPatch(args.patch, fallbackPath);
  }

  const path = typeof args.path === 'string' ? args.path : '';

  // 2. edits as a JSON string (built-in legacy parity: Opus 4.6, GLM-5.1).
  if (typeof args.edits === 'string') {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) return parseEditsArray(parsed, path);
    } catch {
      /* malformed JSON — fall through */
    }
    return null;
  }

  // 1. Primary contract.
  if (Array.isArray(args.edits)) {
    const reqs = parseEditsArray(args.edits, path);
    return reqs.length > 0 ? reqs : null;
  }

  // 3. Legacy top-level oldText/newText merged into edits[].
  if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
    const req = toEditRequest(args, path);
    return req ? [req] : null;
  }

  return null;
}
