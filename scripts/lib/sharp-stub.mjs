/**
 * Shared wrappers that embed `scripts/lib/sharp-stub-body.js` into the two sharp
 * entry points shipped to the device. The build's `applySharpStub()` and the
 * stub test both call these functions, so the concatenation under test is the
 * concatenation that ships.
 *
 * The prelude hands the body the three capabilities it may not obtain itself
 * (the body stays free of imports): the Electron bridge that reaches the
 * platform image framework, and Node's filesystem and path helpers for the
 * temporary files a bridge conversion exchanges. Every capability is optional:
 * outside Electron the bridge is absent and the body refuses instead of
 * converting.
 */

/** Banner kept on both generated entry points. */
export const SHARP_STUB_HEADER = '/*!\n'
  + ' * Pure-JS sharp stub for HarmonyOS aarch64 (libvips unavailable).\n'
  + ' * See docs/工程规划.md §18.3.\n'
  + ' */\n';

/**
 * Capability prelude for the ESM entry point. `createRequire` keeps the
 * Electron import optional: a plain Node host, such as the stub test, has no
 * `electron` module and must still load this file.
 */
const ESM_PRELUDE = [
  "import { createRequire as __stubCreateRequire } from 'node:module';",
  'const __stubRequire = __stubCreateRequire(import.meta.url);',
  'const stubFs = __stubRequire("node:fs");',
  'const stubPath = __stubRequire("node:path");',
  'const stubOs = __stubRequire("node:os");',
  'const stubSystemPreferences = (() => {',
  '  try { return __stubRequire("electron").systemPreferences; } catch (error) { return undefined; }',
  '})();',
  '',
].join('\n');

/** Capability prelude for the CJS entry point. */
const CJS_PRELUDE = [
  'const stubFs = require("node:fs");',
  'const stubPath = require("node:path");',
  'const stubOs = require("node:os");',
  'const stubSystemPreferences = (() => {',
  '  try { return require("electron").systemPreferences; } catch (error) { return undefined; }',
  '})();',
  '',
].join('\n');

/**
 * Embed the stub body in the ESM entry point.
 * @param {string} body - contents of `scripts/lib/sharp-stub-body.js`.
 * @returns {string} source for `index.mjs`.
 */
export function wrapSharpStubEsm(body) {
  return SHARP_STUB_HEADER + ESM_PRELUDE + body.trimEnd() + '\nsharp.default = sharp;\nexport default sharp;\n';
}

/**
 * Embed the stub body in the CJS entry point.
 * @param {string} body - contents of `scripts/lib/sharp-stub-body.js`.
 * @returns {string} source for `index.cjs`.
 */
export function wrapSharpStubCjs(body) {
  return SHARP_STUB_HEADER + "'use strict';\n\n" + CJS_PRELUDE + body.trimEnd() + '\nmodule.exports = sharp;\n';
}
