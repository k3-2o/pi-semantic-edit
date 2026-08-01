// Aider-format SEARCH/REPLACE block parser.
//
// Accepts the canonical aider edit-block format (path line + fenced block) and
// bare unfenced blocks, mirroring aider's own regex-over-raw-text parser:
//
//   path/to/file.py
//   ```diff                     ← optional fence + optional lang hint
//   <<<<<<< SEARCH
//   old code
//   =======
//   new code
//   >>>>>>> REPLACE
//   ```
//
// Fences are stripped; each block's path comes from the line preceding its
// SEARCH marker (previous block's path reused when absent).

import type { ParsedBlock } from './types';

/** Raised for structurally malformed patch input. */
export class MalformedPatchError extends Error {
  constructor(
    message: string,
    public readonly index: number, // line index (0-based) where parsing failed
  ) {
    super(message);
    this.name = 'MalformedPatchError';
  }
}

/**
 * Parse an aider-format patch string into blocks.
 * Throws MalformedPatchError on malformed input.
 */
export function parseAiderBlocks(text: string): ParsedBlock[] {
  const rawLines = text.split('\n');
  const blocks: ParsedBlock[] = [];
  let currentPath = '';
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Skip fence lines (``` or ```lang) entirely.
    if (isFenceLine(line)) {
      i++;
      continue;
    }

    // Path header: a non-marker, non-fence line immediately followed by a
    // SEARCH marker (possibly after fence lines).
    if (looksLikePathHeader(rawLines, i)) {
      currentPath = line.trim();
      i++;
      continue;
    }

    // SEARCH marker opens a block.
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

/**
 * True if line `i` is a path header: non-empty, not a marker/fence, and the
 * next non-fence line is a SEARCH marker.
 */
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
      // A second ======= while in 'new' is content, not a separator.
      newLines.push(curr);
      continue;
    }

    if (trimmed.startsWith('>>>>>>>')) {
      i++; // consume the REPLACE marker
      break;
    }

    // Fence lines inside a block are content (the outer loop already skips
    // fences between blocks; the block terminates at the REPLACE marker).
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
