/**
 * Unit tests for the resident shell session (`lib/session.js`) driven through
 * the injected `spawn` seam — no real shell, no device.
 *
 * Covers the session rows of `specs/010-tool-bash/test-cases.md` §2
 * (TC-U8, plus the unit portion of AC-13/AC-14) and spec AC-12/AC-14.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { BEGIN_MARKER, END_MARKER } from '../lib/protocol.js'
import { ShellSession } from '../lib/session.js'

/** A spawn seam returning EventEmitter-based fake children and recording writes. */
function fakeSpawn() {
  const children = []
  const writes = []
  const spawn = () => {
    const child = new EventEmitter()
    child.stdin = new EventEmitter()
    child.stdin.write = data => { writes.push(data); return true }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.kill = () => { child.killed = true; return true }
    children.push(child)
    return child
  }
  return { spawn, children, writes }
}

/** Drive one command to its sentinel on the given fake child, using the latest frame. */
function finish(fake, childIndex, output, rc) {
  const token = /'([0-9a-f]{16})'/.exec(fake.writes[fake.writes.length - 1])[1]
  fake.children[childIndex].stdout.emit('data', Buffer.from(
    `\n${BEGIN_MARKER} ${token}\n${output}\n${END_MARKER} ${token} ${rc}\n`,
  ))
}

/** Let the queue microtasks run. */
function tick() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function makeSession(fake, overrides = {}) {
  return new ShellSession({
    shellPath: '/system/bin/sh',
    cwd: '/ws',
    commandTimeoutMs: 10000,
    drainTimeoutMs: 10000,
    maxOutputBytes: 262144,
    spawn: fake.spawn,
    logger: () => {},
    ...overrides,
  })
}

test('a command completes via the sentinel and carries output and exit code', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  const pending = session.run('echo hi')
  finish(fake, 0, 'hi\n', 0)
  const result = await pending
  assert.equal(result.exitCode, 0)
  assert.equal(result.output.toString('utf8'), 'hi\n')
  assert.equal(result.truncated, false)
  assert.equal(result.timedOut, false)
  assert.equal(result.cancelled, false)
  assert.equal(fake.children.length, 1)
})

test('non-zero exit codes are results, not errors (0 / 1 / 127)', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  for (const rc of [0, 1, 127]) {
    const pending = session.run('x')
    await tick()
    finish(fake, 0, 'x', rc)
    assert.equal((await pending).exitCode, rc)
  }
})

test('commands are serialized: the second frame is written only after the first completes', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  const first = session.run('one')
  await tick()
  assert.equal(fake.writes.length, 1)
  const second = session.run('two')
  await tick()
  assert.equal(fake.writes.length, 1, 'second command must not be injected while the first is in flight')
  finish(fake, 0, 'one', 0)
  await first
  await tick()
  assert.equal(fake.writes.length, 2)
  finish(fake, 0, 'two', 0)
  await second
})

test('output beyond maxOutputBytes is truncated but the sentinel still completes', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake, { maxOutputBytes: 4 })
  const pending = session.run('big')
  finish(fake, 0, 'abcdefgh', 0)
  const result = await pending
  assert.equal(result.output.toString('utf8'), 'abcd')
  assert.equal(result.keptBytes, 4)
  assert.equal(result.totalBytes, 8)
  assert.equal(result.truncated, true)
})

test('a command that never reaches the sentinel times out, drains, then resets once', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake, { commandTimeoutMs: 20, drainTimeoutMs: 15 })
  const result = await session.run('sleep 30')
  assert.equal(result.timedOut, true)
  assert.equal(result.cancelled, false)
  assert.equal(result.reset, true)
  assert.equal(result.exitCode, null)
  assert.deepEqual(session.stats(), { spawns: 1, resets: 1, alive: false })
})

test('a sentinel that arrives during the drain completes without a reset', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake, { commandTimeoutMs: 20, drainTimeoutMs: 500 })
  const pending = session.run('slow')
  await new Promise(resolve => setTimeout(resolve, 40))
  finish(fake, 0, 'late\n', 5)
  const result = await pending
  assert.equal(result.timedOut, true)
  assert.equal(result.reset, false)
  assert.equal(result.exitCode, 5)
  assert.equal(result.output.toString('utf8'), 'late\n')
  assert.equal(session.stats().resets, 0)
})

test('cancellation marks the result and resets when the shell cannot resync', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake, { commandTimeoutMs: 10000, drainTimeoutMs: 15 })
  const controller = new AbortController()
  const pending = session.run('sleep 999', { signal: controller.signal })
  controller.abort()
  const result = await pending
  assert.equal(result.cancelled, true)
  assert.equal(result.reset, true)
  assert.equal(result.exitCode, null)
})

test('stdout ending marks the session dead and the next run spawns a fresh child', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  const first = session.run('a')
  await tick()
  fake.children[0].stdout.emit('end')
  const firstResult = await first
  assert.equal(firstResult.reset, true)
  assert.equal(session.stats().alive, false)
  const second = session.run('b')
  await tick()
  assert.equal(fake.children.length, 2)
  finish(fake, 1, 'b', 0)
  await second
  assert.equal(session.stats().spawns, 2)
})

test('a spawn failure is loud and rejects the call', async () => {
  const session = new ShellSession({
    shellPath: '/missing/sh',
    cwd: '/ws',
    commandTimeoutMs: 1000,
    maxOutputBytes: 1024,
    spawn: () => { throw new Error('ENOENT') },
    logger: () => {},
  })
  await assert.rejects(() => session.run('x'), /failed to spawn shell \/missing\/sh/)
})

test('dispose rejects queued work and kills the child', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  const pending = session.run('hang')
  await tick()
  const queued = session.run('later')
  session.dispose()
  await assert.rejects(() => pending)
  await assert.rejects(() => queued)
  assert.equal(fake.children[0].killed, true)
})

test('a stale child cannot settle the next command after a reset (C1)', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  const first = session.run('a')
  await tick()
  finish(fake, 0, 'a', 0)
  assert.equal((await first).reset, false)

  session.reset('regression')
  assert.equal(fake.children[0].killed, true)
  assert.equal(fake.children[0].stdout.listenerCount('end'), 0, 'reset must detach the dropped child')

  const second = session.run('b')
  await tick()
  assert.equal(fake.children.length, 2)
  assert.equal(session.stats().alive, true)

  // Late events from the OLD child must be inert for the live command.
  fake.children[0].stdout.emit('end')
  fake.children[0].stdout.emit('data', Buffer.from('stale'))
  finish(fake, 0, 'stale-sentinel', 0)
  await tick()

  assert.equal(session.stats().alive, true, 'the live session must stay alive')
  assert.equal(session.child, fake.children[1], 'the live child must remain the referenced one')
  assert.equal(session.stats().spawns, 2)

  finish(fake, 1, 'b\n', 7)
  const result = await second
  assert.equal(result.exitCode, 7, 'the live command owns its own sentinel result')
  assert.equal(result.reset, false)
  assert.equal(result.output.toString('utf8'), 'b\n')
  assert.equal(session.stats().resets, 1)
})

test('a dropped child whose listeners remain cannot complete the live command (C1 ghost guard)', async () => {
  const fake = fakeSpawn()
  const session = makeSession(fake)
  const first = session.run('a')
  await tick()
  // stdout close drops the child but (by design) does not detach its listeners.
  fake.children[0].stdout.emit('end')
  assert.equal((await first).reset, true)

  const second = session.run('b')
  await tick()
  assert.equal(fake.children.length, 2)

  // The dead child's still-attached listeners must not settle the new command.
  finish(fake, 0, 'ghost', 0)
  fake.children[0].stdout.emit('end')
  await tick()
  assert.equal(session.stats().alive, true, 'the ghost child must not mark the session dead')
  assert.equal(session.child, fake.children[1], 'the live child must remain the referenced one')

  finish(fake, 1, 'b', 0)
  const result = await second
  assert.equal(result.exitCode, 0)
  assert.equal(result.reset, false)
})
