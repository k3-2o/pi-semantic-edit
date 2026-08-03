import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { statSync } from 'node:fs';
import { ReadRegistry } from './src/domain/stale-read';
import { installReadObserver } from './src/pi/read-observer';
import { createRobustEditTool } from './src/pi/tool';

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const registry = new ReadRegistry({ stat: statSync });

  pi.registerTool(createRobustEditTool(cwd, pi, registry));
  installReadObserver(pi, registry, cwd);
}
