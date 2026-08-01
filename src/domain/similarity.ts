// Byte-level LCS similarity ratio — port of OpenDev's passes.rs `similarity()`
// (mirrors Python's difflib.SequenceMatcher.ratio): 2 * LCS / (lenA + lenB).

export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;
  return (2.0 * lcsLength(a, b)) / (a.length + b.length);
}

/** Longest common subsequence length (space-optimized DP). */
function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // UTF-16 code units — matches OpenDev's byte-level counting for the same data.
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(curr[j - 1], prev[j]);
      }
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return Math.max(...prev, 0);
}
