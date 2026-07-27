import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createRobustEditTool } from './src/tool';

/**
 * Pi extension entry point.
 * Registers the `edit_robust` tool that replaces the brittle exact-text contract
 * with a robust, model-agnostic search/replace harness.
 */
export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  pi.registerTool(createRobustEditTool(cwd, pi));
}
