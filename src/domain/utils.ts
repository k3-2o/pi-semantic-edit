import { resolve } from 'node:path';

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function detectLineEnding(content: string): '\n' | '\r\n' {
  const crlf = content.indexOf('\r\n');
  const lf = content.indexOf('\n');
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return '\r\n';
  return '\n';
}

export function restoreLineEndings(text: string, ending: '\n' | '\r\n'): string {
  if (ending === '\r\n') return text.replace(/\n/g, '\r\n');
  return text;
}

export function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: content.slice(0, 1), text: content.slice(1) };
  }
  return { bom: '', text: content };
}

export function resolveToCwd(userPath: string, cwd: string): string {
  if (userPath.startsWith('/')) return userPath;
  if (userPath.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return home ? userPath.replace(/^~/, home) : userPath;
  }
  return resolve(cwd, userPath);
}
