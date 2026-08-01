// Small pure text/path utilities shared by the domain layer.

import { resolve } from 'node:path';

/** Normalize CRLF and lone CR to LF (OpenDev parity: normalize_line_endings). */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Detect the dominant line ending of a file: '\n' or '\r\n'. */
export function detectLineEnding(content: string): '\n' | '\r\n' {
  const crlf = content.indexOf('\r\n');
  const lf = content.indexOf('\n');
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return '\r\n';
  return '\n';
}

/** Restore the original line ending style onto LF-normalized text. */
export function restoreLineEndings(text: string, ending: '\n' | '\r\n'): string {
  if (ending === '\r\n') return text.replace(/\n/g, '\r\n');
  return text;
}

/** Strip a UTF-8 BOM if present; returns the BOM and the remaining text. */
export function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: content.slice(0, 1), text: content.slice(1) };
  }
  return { bom: '', text: content };
}

/** Resolve a user-provided path (relative or absolute) against cwd. */
export function resolveToCwd(userPath: string, cwd: string): string {
  if (userPath.startsWith('/')) return userPath;
  if (userPath.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return home ? userPath.replace(/^~/, home) : userPath;
  }
  return resolve(cwd, userPath);
}
