/**
 * Self-test for the shared transfer planner (`lib/transfer.js`) behind the
 * `copy` and `move` tools.
 *
 * Runs on plain Node with no test framework and no dependency: the planner is
 * handed a `ctx.fs`-shaped object and driven against an in-memory stub, so the
 * recursion, the destination resolution, the empty-directory and irregular-entry
 * refusals, and the byte-faithful write are all proved without touching a real
 * disk or importing any dsh package. `lib/transfer.js` is deliberately
 * import-free, which is what makes this possible.
 *
 * Run: `node tests/transfer.test.mjs` — exits non-zero when any check fails.
 */

import assert from 'node:assert/strict'
import { copyPlannedFiles, describeTreeRefusal, planTransferTree } from '../lib/transfer.js'

/**
 * An in-memory `ctx.fs`-shaped stub over a flat path table. Children are derived
 * from the table's keys, so a path with no entry and no children is simply absent.
 * @param entries - flat `path -> node` map; a node is `{ type, content? }`.
 * @returns the stub plus a call log for asserting what was touched.
 */
function createFakeFs(entries) {
  const log = { listed: [], read: [], written: [] }
  const targetOf = path => ({ targetKey: path, displayPath: path })
  const join = (cwd, path) => {
    if (path.startsWith('/')) return path
    if (cwd === undefined || cwd === '') return path
    return cwd.endsWith('/') ? cwd + path : `${cwd}/${path}`
  }
  const childrenOf = (path) => {
    const prefix = path.endsWith('/') ? path : `${path}/`
    const names = new Set()
    for (const key of entries.keys()) {
      if (key === path || !key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.length === 0) continue
      names.add(rest.split('/')[0])
    }
    return [...names].sort().map((name) => {
      const childPath = prefix + name
      const node = entries.get(childPath)
      return { name, type: node?.type ?? 'directory', target: targetOf(childPath) }
    })
  }
  return {
    log,
    async listDir(target) {
      log.listed.push(target.targetKey)
      return childrenOf(target.targetKey)
    },
    async resolve(path, opts) {
      return targetOf(join(opts?.cwd, path))
    },
    async readBytes(target, _signal, maxBytes) {
      log.read.push({ path: target.targetKey, maxBytes })
      const node = entries.get(target.targetKey)
      if (node?.type !== 'file') throw new Error(`not a file: ${target.targetKey}`)
      return Buffer.isBuffer(node.content) ? Buffer.from(node.content) : new TextEncoder().encode(node.content ?? '')
    },
    async writeBytes(target, bytes, intent, _signal, policy) {
      log.written.push({
        path: target.targetKey,
        bytes: Buffer.from(bytes),
        text: new TextDecoder().decode(bytes),
        intent,
        policy,
      })
    },
  }
}

const TRANSFER = { signal: undefined, policy: 'POLICY', maxTransferBytes: 4096 }
const source = path => ({ targetKey: path, displayPath: path })

const tests = []
function test(name, body) { tests.push({ name, body }) }

test('plans every file under a nested directory', async () => {
  const fs = createFakeFs(new Map([
    ['/src', { type: 'directory' }],
    ['/src/a.txt', { type: 'file', content: 'A' }],
    ['/src/nested', { type: 'directory' }],
    ['/src/nested/b.bin', { type: 'file', content: 'B' }],
  ]))
  const plan = await planTransferTree(fs, source('/src'), source('/dst'), TRANSFER)
  assert.deepEqual(plan.files.map(f => [f.source.displayPath, f.destination.displayPath]), [
    ['/src/a.txt', '/dst/a.txt'],
    ['/src/nested/b.bin', '/dst/nested/b.bin'],
  ])
  assert.deepEqual(plan.emptyDirectories, [])
  assert.deepEqual(plan.irregular, [])
})

test('plans a single file inside a directory', async () => {
  const fs = createFakeFs(new Map([
    ['/src', { type: 'directory' }],
    ['/src/only.txt', { type: 'file', content: 'only' }],
  ]))
  const plan = await planTransferTree(fs, source('/src'), source('/dst'), TRANSFER)
  assert.equal(plan.files.length, 1)
  assert.equal(plan.files[0].destination.displayPath, '/dst/only.txt')
})

test('records a directory that would be empty at the destination', async () => {
  const fs = createFakeFs(new Map([
    ['/src', { type: 'directory' }],
    ['/src/keep.txt', { type: 'file', content: 'k' }],
    ['/src/hollow', { type: 'directory' }],
  ]))
  const plan = await planTransferTree(fs, source('/src'), source('/dst'), TRANSFER)
  assert.equal(plan.files.length, 1)
  assert.deepEqual(plan.emptyDirectories, ['/src/hollow'])
})

test('records an entry that is neither a file nor a directory', async () => {
  const fs = createFakeFs(new Map([
    ['/src', { type: 'directory' }],
    ['/src/pipe', { type: 'other' }],
    ['/src/ok.txt', { type: 'file', content: 'ok' }],
  ]))
  const plan = await planTransferTree(fs, source('/src'), source('/dst'), TRANSFER)
  assert.deepEqual(plan.irregular, ['/src/pipe'])
  assert.deepEqual(plan.files.map(f => f.source.displayPath), ['/src/ok.txt'])
})

test('resolves each destination against the destination directory, not the source', async () => {
  const fs = createFakeFs(new Map([
    ['/src', { type: 'directory' }],
    ['/src/a', { type: 'directory' }],
    ['/src/a/leaf.txt', { type: 'file', content: 'x' }],
  ]))
  const plan = await planTransferTree(fs, source('/src'), source('/other/dst'), TRANSFER)
  assert.deepEqual(plan.files.map(f => f.destination.displayPath), ['/other/dst/a/leaf.txt'])
})

test('lists every visited directory exactly once', async () => {
  const fs = createFakeFs(new Map([
    ['/src', { type: 'directory' }],
    ['/src/a', { type: 'directory' }],
    ['/src/a/f.txt', { type: 'file', content: 'f' }],
    ['/src/b', { type: 'directory' }],
    ['/src/b/g.txt', { type: 'file', content: 'g' }],
  ]))
  await planTransferTree(fs, source('/src'), source('/dst'), TRANSFER)
  assert.deepEqual(fs.log.listed, ['/src', '/src/a', '/src/b'])
})

test('accepts a clean plan', () => {
  assert.equal(describeTreeRefusal('copy', source('/src'), { files: [], emptyDirectories: [], irregular: [] }), null)
})

test('refuses an irregular entry, naming it and the seam code', () => {
  const refusal = describeTreeRefusal('move', source('/src'), { files: [], emptyDirectories: [], irregular: ['/src/pipe'] })
  assert.equal(refusal.code, 'FS_NOT_REGULAR_FILE')
  assert.equal(refusal.message, 'cannot move "/src/pipe": not a regular file or directory')
})

test('refuses an empty directory, naming it and the seam code', () => {
  const refusal = describeTreeRefusal('copy', source('/src'), { files: [], emptyDirectories: ['/src/hollow'], irregular: [] })
  assert.equal(refusal.code, 'FS_IO_ERROR')
  assert.match(refusal.message, /^cannot copy "\/src": "\/src\/hollow" would be empty at the destination/)
})

test('names every empty directory that blocks the plan', () => {
  const refusal = describeTreeRefusal('copy', source('/src'), { files: [], emptyDirectories: ['/src/a', '/src/b'], irregular: [] })
  assert.match(refusal.message, /"\/src\/a", "\/src\/b" would be empty/)
})

test('prefers the irregular refusal when both apply', () => {
  const refusal = describeTreeRefusal('copy', source('/src'), {
    files: [],
    emptyDirectories: ['/src/hollow'],
    irregular: ['/src/pipe'],
  })
  assert.equal(refusal.code, 'FS_NOT_REGULAR_FILE')
})

test('copies every planned file byte-for-byte with createIfAbsent', async () => {
  const fs = createFakeFs(new Map([
    ['/src/a.bin', { type: 'file', content: 'A' }],
    ['/src/b.bin', { type: 'file', content: 'B' }],
  ]))
  const plan = {
    files: [
      { source: source('/src/a.bin'), destination: source('/dst/a.bin') },
      { source: source('/src/b.bin'), destination: source('/dst/b.bin') },
    ],
    emptyDirectories: [],
    irregular: [],
  }
  const written = await copyPlannedFiles(fs, plan, TRANSFER)
  assert.equal(written, 2)
  assert.deepEqual(fs.log.written.map(w => [w.path, w.text, w.intent, w.policy]), [
    ['/dst/a.bin', 'A', { kind: 'createIfAbsent' }, 'POLICY'],
    ['/dst/b.bin', 'B', { kind: 'createIfAbsent' }, 'POLICY'],
  ])
})

test('carries arbitrary bytes through unchanged', async () => {
  const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x41, 0x0a, 0x7f])
  const fs = createFakeFs(new Map([['/src/raw.bin', { type: 'file', content: bytes }]]))
  const plan = { files: [{ source: source('/src/raw.bin'), destination: source('/dst/raw.bin') }], emptyDirectories: [], irregular: [] }
  await copyPlannedFiles(fs, plan, TRANSFER)
  assert.equal(fs.log.written[0].path, '/dst/raw.bin')
  assert.deepEqual(fs.log.written[0].bytes, bytes)
})

test('passes the per-file byte cap through to readBytes', async () => {
  const fs = createFakeFs(new Map([['/src/a.txt', { type: 'file', content: 'a' }]]))
  const plan = { files: [{ source: source('/src/a.txt'), destination: source('/dst/a.txt') }], emptyDirectories: [], irregular: [] }
  await copyPlannedFiles(fs, plan, { ...TRANSFER, maxTransferBytes: 12345 })
  assert.deepEqual(fs.log.read, [{ path: '/src/a.txt', maxBytes: 12345 }])
})

test('passes the per-call policy through to every write', async () => {
  const fs = createFakeFs(new Map([['/src/a.txt', { type: 'file', content: 'a' }]]))
  const plan = { files: [{ source: source('/src/a.txt'), destination: source('/dst/a.txt') }], emptyDirectories: [], irregular: [] }
  await copyPlannedFiles(fs, plan, { ...TRANSFER, policy: { mode: 'danger-full-access' } })
  assert.deepEqual(fs.log.written[0].policy, { mode: 'danger-full-access' })
})

test('writes nothing when the plan has no files', async () => {
  const fs = createFakeFs(new Map())
  const written = await copyPlannedFiles(fs, { files: [], emptyDirectories: [], irregular: [] }, TRANSFER)
  assert.equal(written, 0)
  assert.deepEqual(fs.log.written, [])
})

test('reads each source exactly once', async () => {
  const fs = createFakeFs(new Map([
    ['/src/a', { type: 'directory' }],
    ['/src/a/f.txt', { type: 'file', content: 'f' }],
    ['/src/b', { type: 'directory' }],
    ['/src/b/g.txt', { type: 'file', content: 'g' }],
  ]))
  const plan = await planTransferTree(fs, source('/src'), source('/dst'), TRANSFER)
  await copyPlannedFiles(fs, plan, TRANSFER)
  assert.deepEqual(fs.log.read.map(r => r.path), ['/src/a/f.txt', '/src/b/g.txt'])
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
