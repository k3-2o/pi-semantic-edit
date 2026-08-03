// ReadRegistry — stale-read detection (paper: FileTimeTracker + assert_fresh).
// Records when the agent last read a file; edits are rejected when the file's
// mtime is newer than that read (+ tolerance). Clock/stat are injected so
// tests use fake time; the Pi adapter feeds reads, the tool self-refreshes
// after a successful write (its result contains the new file state).

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
    let mtime: number;
    try {
      mtime = this.stat(path).mtimeMs;
    } catch {
      // stat can throw if the file was deleted after the agent read it — treat
      // as stale (the edit cannot target a file that no longer exists).
      return false;
    }
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
    // Record the file's mtime (our write's actual timestamp) — if the file's
    // clock is ahead (skew/NFS), now() would be older than the mtime and the
    // next edit would false-positive stale. Fall back to now() if stat throws.
    let mtime: number;
    try {
      mtime = this.stat(path).mtimeMs;
    } catch {
      mtime = this.now();
    }
    this.reads.set(path, Math.max(mtime, this.now()));
  }

  /** Forget all records (extension reload / session reset). */
  reset(): void {
    this.reads.clear();
  }
}
