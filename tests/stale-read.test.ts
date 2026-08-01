import { describe, expect, it } from 'bun:test';
import { ReadRegistry } from '../src/domain/stale-read';

/** Fake stat: returns a fixed mtime. */
function fakeStat(mtimeMs: number) {
  return () => ({ mtimeMs });
}

describe('ReadRegistry', () => {
  it('records reads and reports lastRead', () => {
    let now = 1000;
    const reg = new ReadRegistry({ now: () => now, stat: fakeStat(0) });
    reg.record('/a.ts');
    expect(reg.lastRead('/a.ts')).toBe(1000);
    now = 2000;
    reg.record('/a.ts');
    expect(reg.lastRead('/a.ts')).toBe(2000);
  });

  it('unread files are fresh (no data to judge staleness)', () => {
    const reg = new ReadRegistry({ now: () => 1000, stat: fakeStat(5000) });
    expect(reg.isFresh('/never-read.ts')).toBe(true);
    expect(reg.assertFresh('/never-read.ts')).toBeNull();
  });

  it('fresh when mtime is within tolerance of read time', () => {
    const reg = new ReadRegistry({ now: () => 1000, stat: fakeStat(1049) });
    reg.record('/a.ts');
    expect(reg.isFresh('/a.ts')).toBe(true);
  });

  it('stale when mtime exceeds read time + 50ms tolerance', () => {
    const reg = new ReadRegistry({ now: () => 1000, stat: fakeStat(1051) });
    reg.record('/a.ts');
    expect(reg.isFresh('/a.ts')).toBe(false);
    const err = reg.assertFresh('/a.ts');
    expect(err).not.toBeNull();
    expect(err!.kind).toBe('stale-read');
    expect(err!.message).toContain('changed since you last read it');
  });

  it('exact boundary (read + 50ms) is still fresh', () => {
    const reg = new ReadRegistry({ now: () => 1000, stat: fakeStat(1050) });
    reg.record('/a.ts');
    expect(reg.isFresh('/a.ts')).toBe(true);
  });

  it('custom tolerance is honored', () => {
    const reg = new ReadRegistry({ now: () => 1000, stat: fakeStat(2000), toleranceMs: 1000 });
    reg.record('/a.ts');
    expect(reg.isFresh('/a.ts')).toBe(true);
  });

  it('selfRefresh marks the file fresh after our own edit', () => {
    const mtime = 5000;
    let now = 1000;
    const reg = new ReadRegistry({ now: () => now, stat: fakeStat(mtime) });
    // read at t=1000, then file changes at mtime=5000
    reg.record('/a.ts');
    expect(reg.isFresh('/a.ts')).toBe(false);
    // our edit completes at t=6000 (after the external change) — the result
    // contains the new file state, so the model's knowledge is fresh
    now = 6000;
    reg.selfRefresh('/a.ts');
    expect(reg.isFresh('/a.ts')).toBe(true);
  });

  it('recorded time advances with the clock', () => {
    let now = 0;
    const reg = new ReadRegistry({ now: () => now, stat: fakeStat(0) });
    now = 500;
    reg.record('/a.ts');
    now = 600; // mtime 0 <= 500+50 → fresh
    expect(reg.isFresh('/a.ts')).toBe(true);
    // file modified at mtime 600
    now = 1000;
    reg.record('/a.ts'); // re-read at 1000
    expect(reg.isFresh('/a.ts')).toBe(true);
  });

  it('reset clears all records', () => {
    const reg = new ReadRegistry({ now: () => 1000, stat: fakeStat(99999) });
    reg.record('/a.ts');
    reg.reset();
    expect(reg.lastRead('/a.ts')).toBeUndefined();
    expect(reg.isFresh('/a.ts')).toBe(true);
  });
});
