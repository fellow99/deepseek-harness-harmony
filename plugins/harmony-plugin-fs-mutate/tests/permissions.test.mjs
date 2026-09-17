/**
 * Self-test for the permission-mode grammar (`lib/permissions.js`).
 *
 * Runs on plain Node with no test framework and no dependency: the module is
 * deliberately import-free, which is what makes this possible. Every rejection
 * case matters, because a mode that parses loosely would reach `ctx.fs.chmod`
 * as some other mode than the caller wrote.
 *
 * Run: `node tests/permissions.test.mjs` — exits non-zero when any check fails.
 */

import assert from 'node:assert/strict'
import { formatPermissionMode, parsePermissionMode } from '../lib/permissions.js'

const tests = []
function test(name, body) { tests.push({ name, body }) }

test('parses a three-digit octal mode', () => {
  assert.deepEqual(parsePermissionMode('644'), { mode: 0o644 })
  assert.deepEqual(parsePermissionMode('755'), { mode: 0o755 })
  assert.deepEqual(parsePermissionMode('600'), { mode: 0o600 })
})

test('parses a four-digit octal mode with special bits', () => {
  assert.deepEqual(parsePermissionMode('0755'), { mode: 0o755 })
  assert.deepEqual(parsePermissionMode('4755'), { mode: 0o4755 })
  assert.deepEqual(parsePermissionMode('2775'), { mode: 0o2775 })
  assert.deepEqual(parsePermissionMode('1777'), { mode: 0o1777 })
  assert.deepEqual(parsePermissionMode('7555'), { mode: 0o7555 })
})

test('parses an all-zero mode', () => {
  assert.deepEqual(parsePermissionMode('000'), { mode: 0 })
  assert.deepEqual(parsePermissionMode('0000'), { mode: 0 })
})

test('refuses a digit outside the octal range', () => {
  assert.ok(parsePermissionMode('888').error)
  assert.ok(parsePermissionMode('6449').error)
})

test('refuses too few digits', () => {
  assert.ok(parsePermissionMode('7').error)
  assert.ok(parsePermissionMode('75').error)
  assert.ok(parsePermissionMode('').error)
})

test('refuses too many digits', () => {
  assert.ok(parsePermissionMode('06444').error)
  assert.ok(parsePermissionMode('123456').error)
})

test('refuses a symbolic mode', () => {
  assert.ok(parsePermissionMode('rwxr-xr-x').error)
  assert.ok(parsePermissionMode('u+rw').error)
})

test('refuses a mode that is not a string', () => {
  assert.ok(parsePermissionMode(0o644).error)
  assert.ok(parsePermissionMode(undefined).error)
  assert.ok(parsePermissionMode(null).error)
})

test('refuses surrounding whitespace rather than trimming it', () => {
  assert.ok(parsePermissionMode(' 644').error)
  assert.ok(parsePermissionMode('644 ').error)
})

test('renders permission bits as four-digit octal', () => {
  assert.equal(formatPermissionMode(0o644), '0644')
  assert.equal(formatPermissionMode(0o755), '0755')
  assert.equal(formatPermissionMode(0o600), '0600')
})

test('renders zero in full', () => {
  assert.equal(formatPermissionMode(0), '0000')
})

test('renders special bits', () => {
  assert.equal(formatPermissionMode(0o4755), '4755')
  assert.equal(formatPermissionMode(0o1777), '1777')
})

test('ignores bits above the permission range when rendering', () => {
  assert.equal(formatPermissionMode(0o644 | 0o100000), '0644')
})

test('round-trips every accepted mode', () => {
  for (const text of ['000', '001', '644', '666', '777', '0755', '4755', '1777']) {
    const parsed = parsePermissionMode(text)
    assert.equal(parsed.error, undefined, `${text} should parse`)
    assert.equal(formatPermissionMode(parsed.mode), text.padStart(4, '0'))
  }
})

let failed = 0
for (const { name, body } of tests) {
  try {
    await body()
    console.log(`ok - ${name}`)
  } catch (error) {
    failed += 1
    console.error(`not ok - ${name}`)
    console.error(error instanceof Error ? error.stack : String(error))
  }
}
console.log(`\n${tests.length - failed} of ${tests.length} checks passed`)
if (failed > 0) process.exitCode = 1
