/**
 * Self-test for the pure `grep` search engine (`lib/search.js`).
 *
 * Runs on plain Node with no test framework and no dependency: the engine is
 * driven against an in-memory `ctx.fs` stub, so the recursion, the filters,
 * the skipping, and the caps are all proved without touching a real disk or
 * importing any dsh package. `lib/search.js` is deliberately import-free,
 * which is what makes this possible.
 *
 * Run: `node tests/search.test.mjs` — exits non-zero when any check fails.
 */

import assert from 'node:assert/strict'
import { DEFAULT_LIMITS, compileInclude, formatSearchResult, runSearch } from '../lib/search.js'

/**
 * One in-memory tree, keyed by `/`-joined path relative to the search root.
 * Directories are implicit in the key structure; a node with `binary: true`
 * throws from `readText`, and a node with `bytes` reports that size from `stat`.
 */
const MAIN_TREE = {
  'README.md': { text: '# readme\nno hit here\nbut needle lives here\n' },
  'src/index.ts': { text: 'const needle = 1\nother\n' },
  'src/deep/nested.ts': { text: 'first\nsecond\nneedle here\n' },
  'src/deep/hidden.js': { text: 'needle in a nested js file\n' },
  'long.txt': { text: `needle${'x'.repeat(500)}\n` },
  'many.txt': { text: Array.from({ length: 10 }, (_, index) => `needle ${index + 1}`).join('\n') },
  'blob.bin': { binary: true },
  'huge.js': { text: 'needle in a file the size cap excludes\n', bytes: 5_000_000 },
  'node_modules/dep/index.js': { text: 'needle in a dependency\n' },
  '.git/config': { text: 'needle in git metadata\n' },
  '.hidden/secret.txt': { text: 'needle in a dot directory\n' },
}

/** The reported byte size of one in-memory node. */
function sizeOf(node) {
  if (typeof node.bytes === 'number') return node.bytes
  return node.binary === true ? 64 : Buffer.byteLength(node.text, 'utf8')
}

/**
 * Build the minimal `ctx.fs` surface the engine consumes (`stat`, `listDir`,
 * `readText`), recording what was listed and read so traversal decisions are
 * assertable. `listDir` returns stable name order, like the real seam.
 */
function createFakeFs(tree) {
  const log = { listed: [], read: [] }
  const targetOf = path => ({ targetKey: path, displayPath: path })
  const childrenOf = path => {
    const prefix = path === '' ? '' : `${path}/`
    const children = new Map()
    for (const candidate of Object.keys(tree)) {
      if (candidate === path || !candidate.startsWith(prefix)) continue
      const rest = candidate.slice(prefix.length)
      const separator = rest.indexOf('/')
      const name = separator === -1 ? rest : rest.slice(0, separator)
      if (children.has(name)) continue
      const childPath = `${prefix}${name}`
      const child = tree[childPath]
      children.set(name, child === undefined
        ? { name, type: 'directory', target: targetOf(childPath) }
        : { name, type: 'file', target: targetOf(childPath), size: sizeOf(child) })
    }
    return [...children.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  }
  return {
    log,
    async listDir(target) {
      log.listed.push(target.targetKey)
      return childrenOf(target.targetKey)
    },
    async stat(target) {
      const node = tree[target.targetKey]
      if (node !== undefined) return { type: 'file', size: sizeOf(node), version: 'v1' }
      const isDirectory = Object.keys(tree).some(path => path.startsWith(`${target.targetKey}/`))
      return isDirectory ? { type: 'directory', version: 'v1' } : undefined
    },
    async readText(target) {
      log.read.push(target.targetKey)
      const node = tree[target.targetKey]
      if (node === undefined || node.binary === true) {
        const error = new Error(`cannot read "${target.targetKey}": the content is not UTF-8 text`)
        error.code = 'FS_NOT_TEXT'
        throw error
      }
      return node.text
    },
  }
}

/** Run one search over a tree and also format its result, for the render assertions. */
async function searchTree(tree, options) {
  const fs = createFakeFs(tree)
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const result = await runSearch(fs, {
    pattern: options.pattern,
    root: { targetKey: '', displayPath: '.' },
    rootType: 'directory',
    include: options.include === undefined ? undefined : compileInclude(options.include),
    limits,
    signal: options.signal,
  })
  return { fs, limits, result, text: formatSearchResult(result, limits) }
}

const tests = []
function test(name, body) {
  tests.push({ name, body })
}

test('finds a nested match with its 1-based line number and renders "<path>:<line>: <text>"', async () => {
  const { result, text } = await searchTree(MAIN_TREE, { pattern: 'needle' })
  const nested = result.matches.find(match => match.path === 'src/deep/nested.ts')
  assert.ok(nested, 'the nested match must be found')
  assert.equal(nested.lineNumber, 3)
  assert.equal(nested.line, 'needle here')
  assert.ok(text.includes('src/deep/nested.ts:3: needle here'), `the match row must be rendered:\n${text}`)
  assert.equal(result.filesSearched, 6)
  assert.equal(result.filesSkipped, 2)
})

test('include filters the files searched, basename-only when it has no separator', async () => {
  const { fs, result } = await searchTree(MAIN_TREE, { pattern: 'needle', include: '*.ts' })
  assert.deepEqual(fs.log.read, ['src/index.ts', 'src/deep/nested.ts'])
  assert.deepEqual([...new Set(result.matches.map(match => match.path))].sort(), ['src/deep/nested.ts', 'src/index.ts'])
  const basenameOnly = compileInclude('*.ts')
  assert.equal(basenameOnly.onBasename, true)
  assert.equal(basenameOnly.regex.test('nested.ts'), true)
  assert.equal(basenameOnly.regex.test('nested.tsx'), false)
  assert.equal(basenameOnly.regex.test('deep/nested.ts'), false)
  const anchored = compileInclude('src/deep/*.ts')
  assert.equal(anchored.onBasename, false)
  assert.equal(anchored.regex.test('src/deep/nested.ts'), true)
  assert.equal(anchored.regex.test('src/index.ts'), false)
})

test('an unreadable (binary) file is skipped and counted, never thrown', async () => {
  const { fs, result, text } = await searchTree(MAIN_TREE, { pattern: 'needle' })
  assert.ok(fs.log.read.includes('blob.bin'), 'the binary file must have been attempted')
  assert.equal(result.matches.some(match => match.path === 'blob.bin'), false)
  assert.equal(result.filesSkipped, 2)
  assert.ok(text.includes('files skipped as unreadable or too large: 2'), text)
})

test('a file over maxFileBytes is skipped from its stat size, before it is read', async () => {
  const { fs, result } = await searchTree(MAIN_TREE, { pattern: 'needle' })
  assert.equal(fs.log.read.includes('huge.js'), false, 'an over-cap file must not be read')
  assert.equal(result.matches.some(match => match.path === 'huge.js'), false)
})

test('node_modules, .git, and dot-directories are never listed or matched', async () => {
  const { fs, result } = await searchTree(MAIN_TREE, { pattern: 'needle' })
  for (const directory of ['node_modules', '.git', '.hidden']) {
    assert.equal(fs.log.listed.includes(directory), false, `${directory} must not be listed`)
  }
  for (const prefix of ['node_modules/', '.git/', '.hidden/']) {
    assert.equal(result.matches.some(match => match.path.startsWith(prefix)), false, `no match may come from ${prefix}`)
  }
})

test('the total-results cap truncates the walk and the summary says so', async () => {
  const tree = { 'a.txt': { text: 'needle\nneedle\nneedle\n' }, 'b.txt': { text: 'needle\nneedle\n' } }
  const { result, text } = await searchTree(tree, { pattern: 'needle', limits: { maxResults: 3 } })
  assert.equal(result.matches.length, 3)
  assert.equal(result.truncatedResults, true)
  assert.ok(text.includes('Results were truncated because the maxResults cap of 3 was reached'), text)
  assert.ok(text.includes('narrow pattern, path, or include and retry'), text)
})

test('the maxFiles cap truncates the walk and the summary says so', async () => {
  const tree = { 'a.txt': { text: 'needle\n' }, 'b.txt': { text: 'needle\n' }, 'c.txt': { text: 'needle\n' } }
  const { result, text } = await searchTree(tree, { pattern: 'needle', limits: { maxFiles: 2 } })
  assert.equal(result.filesSearched, 2)
  assert.equal(result.matches.length, 2)
  assert.equal(result.truncatedFiles, true)
  assert.ok(text.includes('maxFiles cap of 2 was reached'), text)
})

test('the per-file match cap bounds one file and is reported', async () => {
  const tree = { 'many.txt': { text: 'needle\n'.repeat(10) } }
  const { result, text } = await searchTree(tree, { pattern: 'needle', limits: { maxMatchesPerFile: 2, maxResults: 100 } })
  assert.equal(result.matches.length, 2)
  assert.equal(result.truncatedLines, 1)
  assert.ok(text.includes('matches-per-file cap: 1'), text)
})

test('a matched line is cut at maxLineChars and marked', async () => {
  const tree = { 'long.txt': { text: `needle${'x'.repeat(500)}\n` } }
  const { result, text } = await searchTree(tree, { pattern: 'needle', limits: { maxLineChars: 20 } })
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].line, `needle${'x'.repeat(14)}... (line truncated to 20 chars)`)
  assert.ok(text.includes('... (line truncated to 20 chars)'), text)
})

test('a search with no matches still reports the counts', async () => {
  const { result, text } = await searchTree(MAIN_TREE, { pattern: 'absent-token' })
  assert.equal(result.matches.length, 0)
  assert.ok(text.startsWith('Found 0 matches in 0 files (files searched: 6'), text)
})

test('a file root searches exactly that file', async () => {
  const fs = createFakeFs(MAIN_TREE)
  const result = await runSearch(fs, {
    pattern: 'needle',
    root: { targetKey: 'src/index.ts', displayPath: 'src/index.ts' },
    rootType: 'file',
    limits: { ...DEFAULT_LIMITS },
  })
  assert.deepEqual(fs.log.read, ['src/index.ts'])
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].lineNumber, 1)
})

test('unsupported include filters are rejected loudly', () => {
  for (const invalid of ['', '   ', '!*.ts', '*.{ts,tsx}', '*.ts,*.js']) {
    assert.throws(() => compileInclude(invalid), /include/)
  }
})

test('an invalid regular expression is rejected', async () => {
  await assert.rejects(() => searchTree(MAIN_TREE, { pattern: '(' }), /not a valid JavaScript regular expression/)
})

test('an already-aborted signal stops the walk', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => searchTree(MAIN_TREE, { pattern: 'needle', signal: controller.signal }), /aborted/)
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
