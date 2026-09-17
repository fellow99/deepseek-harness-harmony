/**
 * Parsing and rendering for the model-facing permission-mode argument.
 * Deliberately import-free — no dsh package, no `node:fs` — so the grammar is
 * unit-testable on plain Node and the tool cannot reach a filesystem API here.
 * @module harmony-plugin-fs-mutate/permissions
 */

/** Three or four octal digits: an optional special-bits digit plus `rwx` triplets. */
const MODE_PATTERN = /^[0-7]{3,4}$/

/**
 * Parse a model-supplied permission mode. Only 3- or 4-digit octal is accepted,
 * so `"8"`, `"75"`, `"7555"`, and `"rwxr-xr-x"` are refused before any I/O
 * instead of being reinterpreted as some other mode.
 * @param text - the requested mode.
 * @returns `{ mode }` with the parsed bits, or `{ error }` with the refusal reason.
 */
export function parsePermissionMode(text) {
  if (typeof text !== 'string' || !MODE_PATTERN.test(text)) {
    return { error: 'mode must be 3 or 4 octal digits, for example "644" or "0755"' }
  }
  return { mode: Number.parseInt(text, 8) }
}

/**
 * Render permission bits the way `chmod(1)` prints them: four octal digits, so a
 * read-back mode is unambiguous regardless of the special bits in force.
 * @param mode - the bits to render.
 * @returns the zero-padded octal text.
 */
export function formatPermissionMode(mode) {
  return (mode & 0o7777).toString(8).padStart(4, '0')
}
