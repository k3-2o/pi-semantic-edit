import { isAbsolute, resolve } from 'path';

/**
 * Resolve a user-provided path relative to the current working directory.
 * If the path is absolute, return it as-is.
 */
export function resolveToCwd(userPath: string, cwd: string): string {
  return isAbsolute(userPath) ? resolve(userPath) : resolve(cwd, userPath);
}
