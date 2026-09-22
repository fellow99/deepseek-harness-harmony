/**
 * Unit tests for the sentinel-line protocol engine (`lib/protocol.js`).
 *
 * Runs on plain Node with the built-in test runner; the module under test is
 * import-free, so no device, shell, or dsh package is needed. Covers the
 * protocol rows of `specs/010-tool-bash/test-cases.md` §2 (TC-U1..TC-U3,
 * TC-U8) and spec AC-6/AC-7/AC-8/AC-12.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BEGIN_MARKER, END_MARKER, createParser, frame, generateToken } from '../lib/protocol.js'

const TOKEN = 'aabbccdd00112233'

/** The exact stream the resident shell produces for one command. */
function wire(token, output, rc) {
  return `\n${BEGIN_MARKER} ${token}\n${output}\n${END_MARKER} ${token} ${rc}\n`
}

/** Extract the token the framing embedded, the way the shell would not need to. */
function tokenOf(framing) {
  const match = /'([0-9a-f]{16})'/.exec(framing)
  if (match === null) throw new Error('no token in framing')
  return match[1]
}

test('generateToken is 16 hex chars and honors an injected byte source', () => {
  assert.equal(generateToken(() => Uint8Array.from([0x00, 0x0f, 0xff, 0x01, 0x02, 0x03, 0x04, 0x05])), '000fff0102030405')
  assert.match(generateToken(), /^[0-9a-f]{16}$/)
})

test('frame matches the spec FR-1.5 four-part text verbatim', () => {
  const expected = "printf '\\n__DSH_BASH_BEGIN__ %s\\n' 'aabbccdd00112233'\n"
    + '{ echo hi\n'
    + '} 2>&1\n'
    + '__dsh_rc=$?\n'
    + "printf '\\n__DSH_BASH_END__ %s %s\\n' 'aabbccdd00112233' \"$__dsh_rc\"\n"
  assert.equal(frame(TOKEN, 'echo hi'), expected)
  assert.equal(tokenOf(frame(TOKEN, 'echo hi')), TOKEN)
})

test('BEGIN opens the capture window and END returns its exit code', () => {
  const parser = createParser(TOKEN)
  assert.equal(parser.push(Buffer.from(`\n${BEGIN_MARKER} ${TOKEN}\nhi\n`)), undefined)
  const result = parser.push(Buffer.from(`\n${END_MARKER} ${TOKEN} 0\n`))
  assert.equal(result.exitCode, 0)
  assert.equal(result.output.toString('utf8'), 'hi\n')
  assert.equal(result.totalBytes, 3)
})

test('multi-line output is preserved byte-for-byte', () => {
  const parser = createParser(TOKEN)
  const result = parser.push(Buffer.from(wire(TOKEN, 'one\ntwo\nthree\n', 0)))
  assert.equal(result.output.toString('utf8'), 'one\ntwo\nthree\n')
})

test('output not ending in a newline does not pollute the END marker', () => {
  const parser = createParser(TOKEN)
  const result = parser.push(Buffer.from(wire(TOKEN, 'no-trailing-newline', 7)))
  assert.equal(result.exitCode, 7)
  assert.equal(result.output.toString('utf8'), 'no-trailing-newline')
})

test('NUL and non-UTF-8 bytes survive verbatim', () => {
  const parser = createParser(TOKEN)
  const payload = Buffer.from([0x61, 0x00, 0xff, 0x0a, 0xc3, 0x28])
  const result = parser.push(Buffer.concat([
    Buffer.from(`\n${BEGIN_MARKER} ${TOKEN}\n`),
    payload,
    Buffer.from(`\n${END_MARKER} ${TOKEN} 1\n`),
  ]))
  assert.equal(result.exitCode, 1)
  assert.deepEqual([...result.output], [...payload])
})

test('an approximate END line with the wrong token is treated as output', () => {
  const other = 'ffffffffffffffff'
  const parser = createParser(TOKEN)
  const result = parser.push(Buffer.from(
    `\n${BEGIN_MARKER} ${TOKEN}\n${END_MARKER} ${other} 0\nstill-here\n${END_MARKER} ${TOKEN} 3\n`,
  ))
  assert.equal(result.exitCode, 3)
  assert.equal(result.output.toString('utf8'), `${END_MARKER} ${other} 0\nstill-here`)
})

test('one byte at a time yields the same result as one chunk', () => {
  const stream = Buffer.from(wire(TOKEN, 'chunked\noutput\n', 42))
  const parser = createParser(TOKEN)
  let result
  for (const byte of stream) {
    const step = parser.push(Buffer.from([byte]))
    if (step !== undefined) result = step
  }
  assert.equal(result.exitCode, 42)
  assert.equal(result.output.toString('utf8'), 'chunked\noutput\n')
})

test('exit codes 0, 1 and 127 are carried back', () => {
  for (const rc of [0, 1, 127]) {
    const parser = createParser(TOKEN)
    const result = parser.push(Buffer.from(wire(TOKEN, 'x\n', rc)))
    assert.equal(result.exitCode, rc)
  }
})

test('captureLimit truncates the retained bytes but still drains to the sentinel', () => {
  const parser = createParser(TOKEN, { captureLimit: 4 })
  const result = parser.push(Buffer.from(wire(TOKEN, 'abcdefgh', 0)))
  assert.equal(result.exitCode, 0)
  assert.equal(result.output.toString('utf8'), 'abcd')
  assert.equal(result.totalBytes, 8)
  assert.equal(result.output.length, 4)
})

test('snapshot exposes partial bytes before completion', () => {
  const parser = createParser(TOKEN)
  parser.push(Buffer.from(`\n${BEGIN_MARKER} ${TOKEN}\npart`))
  const snapshot = parser.snapshot()
  assert.equal(snapshot.output.toString('utf8'), 'part')
  assert.equal(snapshot.totalBytes, 4)
})

test('an over-long rc digit run cannot arm completion (M6)', () => {
  const huge = createParser(TOKEN)
  assert.equal(huge.push(Buffer.from(wire(TOKEN, 'x\n', '9'.repeat(20)))), undefined)
  const seven = createParser(TOKEN)
  assert.equal(seven.push(Buffer.from(wire(TOKEN, 'x\n', '1234567'))), undefined)
  const six = createParser(TOKEN)
  assert.equal(six.push(Buffer.from(wire(TOKEN, 'x\n', '123456'))).exitCode, 123456)
})
