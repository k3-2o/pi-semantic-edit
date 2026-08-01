// Feeds the stale-read registry from Pi's built-in `read` tool calls —
// observe, don't override: no risk to the built-in read.

import { isToolCallEventType, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ReadRegistry } from '../domain/stale-read';
import { resolveToCwd } from '../domain/utils';

/** Record every built-in `read` into the registry, keyed by absolute path. */
export function installReadObserver(pi: ExtensionAPI, registry: ReadRegistry, cwd: string): void {
  pi.on('tool_call', (event) => {
    if (isToolCallEventType('read', event)) {
      registry.record(resolveToCwd(event.input.path, cwd));
    }
  });
}
