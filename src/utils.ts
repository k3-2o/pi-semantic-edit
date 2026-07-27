/**
 * Utility functions for file handling and diff generation.
 * Uses zero external dependencies — only Node.js/Bun built-ins.
 */

/** Detect the line-ending style of a text file. */
export function detectLineEnding(content: string): '\n' | '\r\n' {
  const crlfIdx = content.indexOf('\r\n');
  const lfIdx = content.indexOf('\n');
  if (lfIdx === -1) return '\n';
  if (crlfIdx === -1) return '\n';
  return crlfIdx < lfIdx ? '\r\n' : '\n';
}

/** Normalize any line endings to LF. */
export function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Restore the original line endings after editing. */
export function restoreLineEndings(text: string, ending: '\n' | '\r\n'): string {
  if (ending === '\r\n') {
    return text.replace(/\n/g, '\r\n');
  }
  return text;
}

/** Strip UTF-8 BOM if present. Returns the BOM (if any) and the text without it. */
export function stripBom(content: string): { bom: string; text: string } {
  if (content.startsWith('\uFEFF')) {
    return { bom: '\uFEFF', text: content.slice(1) };
  }
  return { bom: '', text: content };
}

/**
 * Normalize text for relaxed matching:
 * - Normalize line endings to LF
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes and dashes (basic Unicode normalization)
 */
export function normalizeForMatching(text: string): string {
  return normalizeToLF(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

/**
 * Generate a line-based diff string with context.
 * Returns the diff and the first changed line number in the new file.
 */
export function generateDiff(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  // Simple line-by-line diff using longest common subsequence
  const lcs = computeLCS(oldLines, newLines);
  const output: string[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  let firstChangedLine: number | undefined;
  let nearChange = false;
  let deferredContext: string[] = [];
  let skipped = false;

  const flushDeferred = () => {
    if (deferredContext.length > 0) {
      for (const line of deferredContext) {
        output.push(`${' '.padStart(lineNumWidth, ' ')} ${line}`);
      }
      deferredContext = [];
    }
  };

  const emitSkipped = () => {
    if (skipped) {
      output.push(`${' '.padStart(lineNumWidth, ' ')} ...`);
      skipped = false;
    }
  };

  for (const { oldI, newI } of lcs) {
    // Emit added lines before this common line
    while (newIdx < newI) {
      if (!nearChange) {
        if (deferredContext.length === 0) {
          emitSkipped();
        }
        deferredContext = [];
      }
      nearChange = true;
      const lineNum = String(newIdx + 1).padStart(lineNumWidth, ' ');
      output.push(`+${lineNum} ${newLines[newIdx]}`);
      if (firstChangedLine === undefined) {
        firstChangedLine = newIdx + 1;
      }
      newIdx++;
    }
    // Emit removed lines before this common line
    while (oldIdx < oldI) {
      if (!nearChange) {
        if (deferredContext.length === 0) {
          emitSkipped();
        }
        deferredContext = [];
      }
      nearChange = true;
      const lineNum = String(oldIdx + 1).padStart(lineNumWidth, ' ');
      output.push(`-${lineNum} ${oldLines[oldIdx]}`);
      if (firstChangedLine === undefined) {
        firstChangedLine = oldIdx + 1;
      }
      oldIdx++;
    }
    // Emit context line (common)
    if (nearChange) {
      nearChange = false;
      deferredContext = [];
    }
    deferredContext.push(newLines[newIdx]);
    if (deferredContext.length > contextLines * 2 + 1) {
      deferredContext = deferredContext.slice(1);
      skipped = true;
    }
    oldIdx = oldI + 1;
    newIdx = newI + 1;
  }

  // Remaining lines after last common line
  while (oldIdx < oldLines.length) {
    const lineNum = String(oldIdx + 1).padStart(lineNumWidth, ' ');
    output.push(`-${lineNum} ${oldLines[oldIdx]}`);
    oldIdx++;
  }
  while (newIdx < newLines.length) {
    const lineNum = String(newIdx + 1).padStart(lineNumWidth, ' ');
    output.push(`+${lineNum} ${newLines[newIdx]}`);
    if (firstChangedLine === undefined) {
      firstChangedLine = newIdx + 1;
    }
    newIdx++;
  }

  // Flush deferred context if any
  if (deferredContext.length > 0 && output.length > 0) {
    flushDeferred();
  }

  return { diff: output.join('\n'), firstChangedLine };
}

/**
 * Compute a longest-common-subsequence path as array of matching indices.
 */
function computeLCS(a: string[], b: string[]): { oldI: number; newI: number }[] {
  const m = a.length;
  const n = b.length;
  // Use the Hirschberg-like approach for memory efficiency, but for source files
  // a standard DP with full table is acceptable for files under ~10K lines.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: { oldI: number; newI: number }[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift({ oldI: i - 1, newI: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

/**
 * Generate a unified patch string.
 */
export function generateUnifiedPatch(path: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const lcs = computeLCS(oldLines, newLines);

  const lines: string[] = [];
  lines.push(`--- ${path}`);
  lines.push(`+++ ${path}`);

  // Build hunks
  let oldIdx = 0;
  let newIdx = 0;
  for (let k = 0; k <= lcs.length; k++) {
    const oldStart = oldIdx;
    const newStart = newIdx;
    let delCount = 0;
    let addCount = 0;

    const hunkOldLines: string[] = [];
    const hunkNewLines: string[] = [];

    if (k < lcs.length) {
      const { oldI, newI } = lcs[k];
      while (oldIdx < oldI || newIdx < newI) {
        if (oldIdx < oldI) {
          hunkOldLines.push(`-${oldLines[oldIdx]}`);
          delCount++;
          oldIdx++;
        }
        if (newIdx < newI) {
          hunkNewLines.push(`+${newLines[newIdx]}`);
          addCount++;
          newIdx++;
        }
      }
      // common line
      hunkOldLines.push(` ${oldLines[oldIdx]}`);
      hunkNewLines.push(` ${newLines[newIdx]}`);
      oldIdx = oldI + 1;
      newIdx = newI + 1;
    } else {
      while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (oldIdx < oldLines.length) {
          hunkOldLines.push(`-${oldLines[oldIdx]}`);
          delCount++;
          oldIdx++;
        }
        if (newIdx < newLines.length) {
          hunkNewLines.push(`+${newLines[newIdx]}`);
          addCount++;
          newIdx++;
        }
      }
    }

    if (delCount > 0 || addCount > 0) {
      lines.push(
        `@@ -${oldStart + 1},${delCount + (hunkOldLines.length - delCount)} +${newStart + 1},${addCount + (hunkNewLines.length - addCount)} @@`,
      );
      lines.push(...hunkOldLines);
      lines.push(...hunkNewLines);
    }
  }

  return lines.join('\n');
}
