/**
 * Config-validation tests for `lib/index.js` (spec FR-5.1 / AC-15 / TC-U9).
 *
 * `lib/index.js` imports the dsh peerDependencies (`@deepseek-ai/*`), which are
 * supplied at runtime from `dsh-dist/node_modules` and are NOT resolvable under
 * a plain `node --test` in this repository (there is no root `node_modules`).
 * `apply` therefore cannot be invoked here, and this file does NOT import any
 * dsh package. The pure validators are extracted to the import-free
 * `lib/config.js` (re-exported by `lib/index.js`) and driven directly: an
 * invalid value throws exactly the error `apply` would surface at composition.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nameSet, positiveInteger, resolveLimits } from '../lib/config.js'

const VALID = { commandTimeoutMs: 120000, maxOutputBytes: 262144, maxCommandChars: 65536 }

test('valid numeric limits pass and are returned unchanged', () => {
  assert.deepEqual(resolveLimits(VALID), VALID)
  assert.equal(positiveInteger(1, 'commandTimeoutMs'), 1)
})

for (const key of ['commandTimeoutMs', 'maxOutputBytes', 'maxCommandChars']) {
  test(`${key} rejects zero, negative, fractional, and non-number values`, () => {
    for (const bad of [0, -1, 1.5, '120000', undefined, null, NaN, Infinity]) {
      assert.throws(() => positiveInteger(bad, key), new RegExp(`${key} must be a positive safe integer`))
      assert.throws(() => resolveLimits({ ...VALID, [key]: bad }), new RegExp(`${key} must be a positive safe integer`))
    }
    assert.equal(resolveLimits({ ...VALID, [key]: 7 })[key], 7)
  })
}

test('nameSet accepts a non-empty string list and rejects malformed ones', () => {
  assert.deepEqual([...nameSet(['ls', 'cat'], 'allowCommands')], ['ls', 'cat'])
  assert.deepEqual([...nameSet([], 'allowCommands')], [], 'the default empty list is valid')
  for (const bad of ['ls', [''], ['   '], ['ok', 3], [null], [undefined]]) {
    assert.throws(() => nameSet(bad, 'allowCommands'), /allowCommands must be an array of non-empty strings/)
  }
})
