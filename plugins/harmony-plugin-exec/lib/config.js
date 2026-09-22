/**
 * Configuration validation for the `bash` plugin, kept import-free so
 * `node:test` can drive the pure validators on bare Node.
 *
 * `lib/index.js` imports the dsh peerDependencies (`@deepseek-ai/*`), which are
 * supplied at runtime from `dsh-dist/node_modules` and are NOT resolvable under
 * a plain `node --test` in this repository. The validators therefore live here
 * (zero imports, like `protocol.js`/`fence.js`/`inventory.js`) and
 * `lib/index.js` re-exports them; `tests/index.test.mjs` imports this module
 * directly and never touches a dsh package.
 * @module harmony-plugin-exec/config
 */

/** Assert one numeric limit is a positive safe integer (spec FR-5.1). */
export function positiveInteger(value, key) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`harmony-plugin-exec: ${key} must be a positive safe integer`)
  }
  return value
}

/** Assert a value is a list of non-empty strings, returning it as a Set. */
export function nameSet(value, key) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`harmony-plugin-exec: ${key} must be an array of non-empty strings`)
  }
  return new Set(value)
}

/**
 * Validate the three numeric limits exactly as `apply` does, so an invalid
 * value fails plugin composition with the same message (spec FR-5.1 / AC-15).
 * @param {{ commandTimeoutMs: unknown, maxOutputBytes: unknown, maxCommandChars: unknown }} config
 * @returns {{ commandTimeoutMs: number, maxOutputBytes: number, maxCommandChars: number }}
 */
export function resolveLimits(config) {
  return {
    commandTimeoutMs: positiveInteger(config.commandTimeoutMs, 'commandTimeoutMs'),
    maxOutputBytes: positiveInteger(config.maxOutputBytes, 'maxOutputBytes'),
    maxCommandChars: positiveInteger(config.maxCommandChars, 'maxCommandChars'),
  }
}
