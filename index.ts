import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createRobustEditTool } from './src/pi/tool';

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  pi.registerTool(createRobustEditTool(cwd, pi));
}
