/**
 * Shared wrappers that embed `scripts/lib/sharp-stub-body.js` into the two sharp
 * entry points shipped to the device. The build's `applySharpStub()` and the
 * stub test both call these functions, so the concatenation under test is the
 * concatenation that ships.
 */

/** Banner kept on both generated entry points. */
export const SHARP_STUB_HEADER = '/*!\n'
  + ' * Pure-JS sharp stub for HarmonyOS aarch64 (libvips unavailable).\n'
  + ' * See docs/工程规划.md §18.3.\n'
  + ' */\n';

/**
 * Embed the stub body in the ESM entry point.
 * @param {string} body - contents of `scripts/lib/sharp-stub-body.js`.
 * @returns {string} source for `index.mjs`.
 */
export function wrapSharpStubEsm(body) {
  return SHARP_STUB_HEADER + body.trimEnd() + '\nsharp.default = sharp;\nexport default sharp;\n';
}

/**
 * Embed the stub body in the CJS entry point.
 * @param {string} body - contents of `scripts/lib/sharp-stub-body.js`.
 * @returns {string} source for `index.cjs`.
 */
export function wrapSharpStubCjs(body) {
  return SHARP_STUB_HEADER + "'use strict';\n\n" + body.trimEnd() + '\nmodule.exports = sharp;\n';
}
