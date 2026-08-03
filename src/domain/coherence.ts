// --- Non-blocking structural warnings on the result (brace balance + indent jumps) ---

export function coherenceCheck(content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split('\n');

  let balance = 0;
  for (const ch of content) {
    if (ch === '{' || ch === '(' || ch === '[') balance++;
    if (ch === '}' || ch === ')' || ch === ']') balance--;
  }

  if (balance > 0) {
    warnings.push(`Unclosed ${balance} brace(s)/paren(s)/bracket(s).`);
  } else if (balance < 0) {
    warnings.push(`Too many closing braces/parens/brackets (excess: ${-balance}).`);
  }

  // --- Flag drastic indent jumps (>4 spaces) vs. previous non-empty line ---
  for (let i = 1; i < lines.length; i++) {
    const indent = lines[i].search(/\S/);
    if (indent < 0) continue;

    const prev = findPrevNonEmptyLine(lines, i);
    if (prev === -1) continue;
    const prevIndent = lines[prev].search(/\S/);
    if (prevIndent >= 0 && Math.abs(indent - prevIndent) > 4) {
      warnings.push(
        `Line ${i + 1} has suspicious indentation jump (from ${prevIndent} to ${indent} spaces).`,
      );
    }
  }

  return warnings;
}

function findPrevNonEmptyLine(lines: string[], currentIdx: number): number {
  for (let i = currentIdx - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) return i;
  }
  return -1;
}
