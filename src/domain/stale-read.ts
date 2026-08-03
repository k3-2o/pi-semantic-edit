// --- ReadRegistry — stale-read detection (paper: FileTimeTracker + assert_fresh) ---
// --- Clock/stat injected for tests; adapter feeds reads, tool self-refreshes after write ---

import type { EditError } from './types';

interface StatLike {
  mtimeMs: number;
}

export type StatFn = (path: string) => StatLike;
export type NowFn = () => number;

const DEFAULT_TOLERANCE_MS = 50; // from the paper

export class ReadRegistry {
  private reads = new Map<string, number>();
  private readonly toleranceMs: number;
  private readonly now: NowFn;
  private readonly stat: StatFn;

  constructor(opts: { now?: NowFn; stat: StatFn; toleranceMs?: number }) {
    this.now = opts.now ?? Date.now;
    this.stat = opts.stat;
    this.toleranceMs = opts.toleranceMs ?? DEFAULT_TOLERANCE_MS;
  }

  record(path: string): void {
    this.reads.set(path, this.now());
  }

  lastRead(path: string): number | undefined {
    return this.reads.get(path);
  }

  // --- Fresh unless mtime newer than last read (+tolerance); never-read files are fresh (OpenDev parity) ---
  isFresh(path: string): boolean {
    const readAt = this.reads.get(path);
    if (readAt === undefined) return true;
    let mtime: number;
    try {
      mtime = this.stat(path).mtimeMs;
    } catch {
      // --- stat throws if the file was deleted after read — treat as stale ---
      return false;
    }
    return mtime <= readAt + this.toleranceMs;
  }

  assertFresh(path: string): EditError | null {
    if (this.isFresh(path)) return null;
    return {
      kind: 'stale-read',
      message:
        'The file has changed since you last read it; re-read the file and retry your edit with the current content.',
    };
  }

  // --- Mark freshly known (called after our own successful edit) ---
  selfRefresh(path: string): void {
    // --- Record mtime (our write's timestamp), not now(): skewed clocks would false-positive stale; fall back to now() if stat throws ---
    let mtime: number;
    try {
      mtime = this.stat(path).mtimeMs;
    } catch {
      mtime = this.now();
    }
    this.reads.set(path, Math.max(mtime, this.now()));
  }

  reset(): void {
    this.reads.clear();
  }
}
