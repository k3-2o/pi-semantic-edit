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

function editsFromPatch(patch: string, defaultPath: string): EditRequestLike[] {
  const blocks = parseAiderBlocks(patch);
  return blocks.map((b) => ({
    path: b.path || defaultPath,
    oldText: b.oldText,
    newText: b.newText,
    replaceAll: false,
  }));
}

export function normalizeEditArgs(input: unknown): EditRequestLike[] | null {
  if (typeof input !== 'object' || input === null) return null;
  const args = input as Record<string, unknown>;

  if (typeof args.patch === 'string') {
    const fallbackPath = typeof args.path === 'string' ? args.path : '';
    return editsFromPatch(args.patch, fallbackPath);
  }

  const path = typeof args.path === 'string' ? args.path : '';

  if (typeof args.edits === 'string') {
    try {
      const parsed = JSON.parse(args.edits);
      if (Array.isArray(parsed)) return parseEditsArray(parsed, path);
      const parsedSingle = toEditRequest(parsed, path);
      if (parsedSingle) return [parsedSingle];
    } catch {
      /* --- malformed JSON fall through --- */
    }
    return null;
  }

  if (Array.isArray(args.edits)) {
    const reqs = parseEditsArray(args.edits, path);
    return reqs.length > 0 ? reqs : null;
  }

  const single = toEditRequest(args.edits, path);
  if (single) return [single];

  if (typeof args.oldText === 'string' && typeof args.newText === 'string') {
    const req = toEditRequest(args, path);
    return req ? [req] : null;
  }

  return null;
}
