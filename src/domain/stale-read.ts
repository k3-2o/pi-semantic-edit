// ReadRegistry — stale-read detection (paper: FileTimeTracker + assert_fresh).
//
// Records when the agent last "read" a file and rejects edits when the file's
// mtime is newer than that read (+ tolerance). The registry is pure: clock and
// stat are injected, so tests use fake time/filesystems. The Pi adapter
// (read-observer) feeds records from built-in `read` calls; the tool calls
// selfRefresh() after a successful write (the edit result contains the new
// file state, so the model's knowledge is fresh — prevents edit→edit
// false positives).

import type { EditError } from './types';

export interface StatLike {
  mtimeMs: number;
}

export type StatFn = (path: string) => StatLike;
export type NowFn = () => number;

export const DEFAULT_TOLERANCE_MS = 50; // from the paper

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

  /** Record a read of `path` at the current time. */
  record(path: string): void {
    this.reads.set(path, this.now());
  }

  /** Last recorded read time for `path` (ms epoch), or undefined. */
  lastRead(path: string): number | undefined {
    return this.reads.get(path);
  }

  /**
   * True if the file's mtime is not newer than the last recorded read
   * (+ tolerance). A file that was never read is considered fresh (no data
   * to judge staleness — matches OpenDev, which only validates after reads).
   */
  isFresh(path: string): boolean {
    const readAt = this.reads.get(path);
    if (readAt === undefined) return true;
    const mtime = this.stat(path).mtimeMs;
    return mtime <= readAt + this.toleranceMs;
  }

  /**
   * Returns a stale-read EditError if the file changed since the last read,
   * else null. Stale checks only apply to files the agent has actually read.
   */
  assertFresh(path: string): EditError | null {
    if (this.isFresh(path)) return null;
    return {
      kind: 'stale-read',
      message:
        'The file has changed since you last read it; re-read the file and retry your edit with the current content.',
    };
  }

  /** Mark the file as freshly known (called after our own successful edit). */
  selfRefresh(path: string): void {
    this.record(path);
  }

  /** Forget all records (extension reload / session reset). */
  reset(): void {
    this.reads.clear();
  }
}
