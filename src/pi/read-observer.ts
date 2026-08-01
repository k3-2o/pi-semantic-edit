// Read observer — feeds the stale-read registry from Pi's built-in `read`
// tool calls, non-invasively (SPEC D5). We observe, we don't override: no risk
// to the built-in read.

import { isToolCallEventType, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ReadRegistry } from '../domain/stale-read';
import { resolveToCwd } from '../domain/utils';

/**
 * Install a tool_call observer that records every built-in `read` into the
 * registry, keyed by the resolved absolute path.
 */
export function installReadObserver(pi: ExtensionAPI, registry: ReadRegistry, cwd: string): void {
  pi.on('tool_call', (event) => {
    if (isToolCallEventType('read', event)) {
      // event.input is { path, offset?, limit? }
      registry.record(resolveToCwd(event.input.path, cwd));
    }
  });
}
