// --- Aider SEARCH/REPLACE parser — deprecated legacy input (primary is edits[], see normalize.ts); kept for session resume ---

import type { ParsedBlock } from './types';

export class MalformedPatchError extends Error {
  constructor(
    message: string,
    public readonly index: number, // --- line index (0-based) where parsing failed ---
  ) {
    super(message);
    this.name = 'MalformedPatchError';
  }
}

export function parseAiderBlocks(text: string): ParsedBlock[] {
  const rawLines = text.split('\n');
  const blocks: ParsedBlock[] = [];
  let currentPath = '';
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (isFenceLine(line)) {
      i++;
      continue;
    }

    if (looksLikePathHeader(rawLines, i)) {
      currentPath = line.trim();
      i++;
      continue;
    }

    if (line.trimStart().startsWith('<<<<<<<')) {
      const block = parseBlock(rawLines, i);
      blocks.push({ path: currentPath, oldText: block.oldText, newText: block.newText });
      i = block.nextIndex;
      continue;
    }

    i++;
  }

  return blocks;
}

function isFenceLine(line: string): boolean {
  const t = line.trimStart();
  return /^```+/.test(t) || /^~~~+/.test(t);
}

function looksLikePathHeader(lines: string[], i: number): boolean {
  const line = lines[i];
  if (line.trim().length === 0) return false;
  if (line.trimStart().startsWith('<<<<<<<')) return false;
  if (line.trimStart().startsWith('=======')) return false;
  if (line.trimStart().startsWith('>>>>>>>')) return false;
  if (isFenceLine(line)) return false;

  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j];
    if (isFenceLine(next)) continue;
    return next.trimStart().startsWith('<<<<<<<');
  }
  return false;
}

interface ParsedBlockRaw {
  oldText: string;
  newText: string;
  nextIndex: number;
}

function parseBlock(lines: string[], start: number): ParsedBlockRaw {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let phase: 'old' | 'new' = 'old';
  let i = start + 1;

  for (; i < lines.length; i++) {
    const curr = lines[i];
    const trimmed = curr.trimStart();

    if (trimmed.startsWith('=======')) {
      if (phase === 'old') {
        phase = 'new';
        continue;
      }
      // --- A second ======= while in 'new' is content, not a separator ---
      newLines.push(curr);
      continue;
    }

    if (trimmed.startsWith('>>>>>>>')) {
      i++; // --- consume the REPLACE marker ---
      break;
    }

    // --- Fence lines inside a block are content; the block ends at the REPLACE marker ---
    if (phase === 'old') oldLines.push(curr);
    else newLines.push(curr);
  }

  if (oldLines.length === 0 && newLines.length === 0) {
    throw new MalformedPatchError('SEARCH block with no content', start);
  }

  return {
    oldText: oldLines.join('\n'),
    newText: newLines.join('\n'),
    nextIndex: i,
  };
}
