import { describe, expect, it } from 'bun:test';
import { applyBlocks, resolveBlocks } from '../src/domain/editor';
import { parseAiderBlocks } from '../src/domain/parser';

function parse(path: string, oldText: string, newText: string) {
  return parseAiderBlocks(
    `${path}\n<<<<<<< SEARCH\n${oldText}\n=======\n${newText}\n>>>>>>> REPLACE`,
  );
}

describe('auto-expand disambiguation', () => {
  it('resolves when exactly ONE occurrence has distinguishable context', () => {
    // 'helper();' appears 2×. The SECOND one sits directly above a unique
    // marker line; the first is at file start. At expansion level 1 the second
    // occurrence's context ('helper();\nhelper();') is unique while the first
    // ('helper();') still matches twice → auto-expand pins the second.
    const content = ['helper();', 'helper();', 'marker();'].join('\n');
    const blocks = parse('f.ts', 'helper();', 'changed();');
    const outcome = resolveBlocks(content, blocks, 'f.ts');
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved![0].match.passName).toBe('auto_expand');
    expect(outcome.resolved![0].start).toBe(content.lastIndexOf('helper();'));

    const applied = applyBlocks(content, blocks, 'f.ts');
    expect(applied.ok).toBe(true);
    expect(applied.content).toBe('helper();\nchanged();\nmarker();');
  });

  it('errors when BOTH occurrences disambiguate simultaneously (formatRow/formatRowAlt)', () => {
    // The smoke-test mission-5 file: identical first lines, different function
    // signatures → expansion makes BOTH unique at once → genuinely ambiguous.
    const content = [
      'function formatRow(item: Item): string {',
      '  const id = item.id;',
      '  const label = item.label;',
      '  return `[${id}] ${label}`;',
      '}',
      '',
      'function formatRowAlt(item: Item): string {',
      '  const id = item.id;',
      '  const label = item.label;',
      '  return `${label} (${id})`;',
      '}',
    ].join('\n');
    const blocks = parse(
      'f.ts',
      '  const id = item.id;\n  const label = item.label;',
      '  const { id, label } = item;',
    );
    const outcome = resolveBlocks(content, blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('ambiguous');
  });

  it('errors when every occurrence shares identical context', () => {
    const content = ['a() {', '  same();', '}', 'b() {', '  same();', '}'].join('\n');
    const blocks = parse('f.ts', '  same();', '  other();');
    const outcome = resolveBlocks(content, blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('ambiguous');
  });

  it('stays ambiguous when all lines are identical (expansion cap)', () => {
    const content = Array.from({ length: 20 }, () => '  boilerplate();').join('\n');
    const blocks = parse('f.ts', '  boilerplate();', '  changed();');
    const outcome = resolveBlocks(content, blocks, 'f.ts');
    expect(outcome.ok).toBe(false);
    expect(outcome.error!.kind).toBe('ambiguous');
  });

  it('does not fire for unique matches (simple pass wins)', () => {
    const blocks = parse('f.ts', 'const unique = 1;', 'const unique = 2;');
    const outcome = resolveBlocks('const unique = 1;\nconst other = 1;', blocks, 'f.ts');
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved![0].match.passName).toBe('simple');
  });

  it('replaceAll bypasses auto-expand entirely (no ambiguity)', () => {
    const content = Array.from({ length: 20 }, () => '  boilerplate();').join('\n');
    const outcome = resolveBlocks(
      content,
      [{ path: 'f.ts', oldText: '  boilerplate();', newText: '  changed();', replaceAll: true }],
      'f.ts',
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.resolved).toHaveLength(20);
    expect(outcome.resolved![0].match.passName).toBe('replace_all');
  });
});
