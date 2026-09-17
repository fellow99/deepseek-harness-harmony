/**
 * Self-test for the pure `glob` discovery engine (`lib/glob.js`).
 *
 * Runs on plain Node with no test framework and no dependency: the engine is
 * driven against an in-memory `ctx.fs` stub, so the recursion, the wildcards,
 * the skipping, the files-only contract, and the caps are all proved without
 * touching a real disk or importing any dsh package. `lib/glob.js` is
 * deliberately import-free, which is what makes this possible.
 *
 * Run: `node tests/glob.test.mjs` — exits non-zero when any check fails.
 */

import assert from 'node:assert/strict'
import { DEFAULT_GLOB_LIMITS, compileGlob, formatGlobResult, runGlob } from '../lib/glob.js'

/**
 * One in-memory tree, keyed by `/`-joined path relative to the search root.
 * Directories are implicit in the key structure; a node present as a key is a
 * file, and any path that only prefixes other paths is a directory.
 */
const MAIN_TREE = {
  'README.md': {},
  'index.ts': {},
  'package.json': {},
  'long-name.ts': {},
  'src/index.ts': {},
  'src/util/helper.ts': {},
  'src/deep/nested.ts': {},
  'src/notes.txt': {},
  'docs/guide.md': {},
  'node_modules/dep/index.js': {},
  '.git/config': {},
  '.hidden/secret.txt': {},
  '.env': {},
  'cache.d/entry.js': {},
}

/**
 * Build the minimal `ctx.fs` surface the engine consumes (`listDir`, plus a
 * `stat` for parity with the real seam), recording what was listed so
 * traversal decisions are assertable. `listDir` returns stable name order,
 * like the real seam.
 */
function createFakeFs(tree) {
  const log = { listed: [] }
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
        : { name, type: 'file', target: targetOf(childPath) })
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
      if (node !== undefined) return { type: 'file', version: 'v1' }
      const isDirectory = Object.keys(tree).some(path => path.startsWith(`${target.targetKey}/`))
      return isDirectory ? { type: 'directory', version: 'v1' } : undefined
    },
  }
}

/** Run one discovery over a tree and also format its result, for the render assertions. */
async function globTree(tree, options) {
  const fs = createFakeFs(tree)
  const limits = { ...DEFAULT_GLOB_LIMITS, ...options.limits }
  const result = await runGlob(fs, {
    matcher: compileGlob(options.pattern),
    root: options.root ?? { targetKey: '', displayPath: '.' },
    rootType: options.rootType ?? 'directory',
    limits,
    signal: options.signal,
  })
  return { fs, limits, result, text: formatGlobResult(result, limits) }
}

const tests = []
function test(name, body) {
  tests.push({ name, body })
}

test('a single "*" stays inside one segment and does not cross a separator', async () => {
  const matcher = compileGlob('src/*.ts')
  assert.equal(matcher.onBasename, false)
  assert.equal(matcher.regex.test('src/index.ts'), true)
  assert.equal(matcher.regex.test('src/deep/nested.ts'), false)
  assert.equal(matcher.regex.test('src/util/helper.ts'), false)
  const { result } = await globTree(MAIN_TREE, { pattern: 'src/*.ts' })
  assert.deepEqual(result.files, ['src/index.ts'])
  assert.equal(compileGlob('*').regex.test('a/b'), false)
})

test('"?" matches exactly one character inside a segment', async () => {
  const matcher = compileGlob('index.?s')
  assert.equal(matcher.regex.test('index.ts'), true)
  assert.equal(matcher.regex.test('index.tss'), false)
  assert.equal(matcher.regex.test('index.s'), false)
  assert.equal(matcher.regex.test('index.'), false)
  const { result } = await globTree(MAIN_TREE, { pattern: 'index.?s' })
  assert.deepEqual(result.files, ['index.ts', 'src/index.ts'])
})

test('"**" matches across segments, including zero directories', async () => {
  const matcher = compileGlob('src/**/*.ts')
  assert.equal(matcher.regex.test('src/index.ts'), true)
  assert.equal(matcher.regex.test('src/deep/nested.ts'), true)
  assert.equal(matcher.regex.test('src/util/helper.ts'), true)
  assert.equal(compileGlob('**/*.ts').regex.test('src/deep/nested.ts'), true)
  const { result } = await globTree(MAIN_TREE, { pattern: 'src/**/*.ts' })
  assert.deepEqual(result.files, ['src/index.ts', 'src/deep/nested.ts', 'src/util/helper.ts'])
})

test('a pattern with no "/" matches the file name at any depth', async () => {
  const { result } = await globTree(MAIN_TREE, { pattern: '*.ts' })
  assert.deepEqual(result.files, [
    'index.ts',
    'long-name.ts',
    'src/index.ts',
    'src/deep/nested.ts',
    'src/util/helper.ts',
  ])
})

test('a backslash separator is normalized to "/"', async () => {
  const matcher = compileGlob('src\\*.ts')
  assert.equal(matcher.onBasename, false)
  assert.equal(matcher.regex.test('src/index.ts'), true)
})

test('a pattern matching nothing returns no files and still reports the counts', async () => {
  const { result, text } = await globTree(MAIN_TREE, { pattern: '**/*.rs' })
  assert.deepEqual(result.files, [])
  assert.equal(result.filesSearched, 11)
  assert.ok(text.startsWith('Found 0 files (files searched: 11)'), text)
})

test('results are files only: a matching directory is never returned', async () => {
  const directoryPattern = compileGlob('*.d')
  assert.equal(directoryPattern.regex.test('cache.d'), true)
  const { result } = await globTree(MAIN_TREE, { pattern: '*.d' })
  assert.deepEqual(result.files, [])
  const all = await globTree(MAIN_TREE, { pattern: '*' })
  for (const directory of ['src', 'docs', 'cache.d', 'node_modules', '.hidden']) {
    assert.equal(all.result.files.includes(directory), false, `${directory} must not be returned`)
  }
  assert.ok(all.result.files.includes('cache.d/entry.js'), 'a file under a matching directory name is still returned')
})

test('hidden files are returned but hidden directories are never listed', async () => {
  const { fs, result } = await globTree(MAIN_TREE, { pattern: '*' })
  assert.ok(result.files.includes('.env'), 'a hidden file must be returned')
  for (const directory of ['.git', '.hidden']) {
    assert.equal(fs.log.listed.includes(directory), false, `${directory} must not be listed`)
  }
  assert.equal(result.files.some(path => path.startsWith('.git/') || path.startsWith('.hidden/')), false)
})

test('node_modules is never listed or matched', async () => {
  const { fs, result } = await globTree(MAIN_TREE, { pattern: '**' })
  assert.equal(fs.log.listed.includes('node_modules'), false)
  assert.equal(result.files.some(path => path.startsWith('node_modules/')), false)
})

test('the rendered body is one path per line, then a blank line, then the summary', async () => {
  const tree = { 'a.ts': {}, 'b.ts': {}, 'c.txt': {} }
  const { text } = await globTree(tree, { pattern: '*.ts' })
  assert.equal(text, 'a.ts\nb.ts\n\nFound 2 files (files searched: 3).')
})

test('the maxResults cap truncates the walk and the summary says so', async () => {
  const tree = { 'a.txt': {}, 'b.txt': {}, 'c.txt': {} }
  const { result, text } = await globTree(tree, { pattern: '*.txt', limits: { maxResults: 2 } })
  assert.deepEqual(result.files, ['a.txt', 'b.txt'])
  assert.equal(result.truncatedResults, true)
  assert.ok(text.includes('Results were truncated because the maxResults cap of 2 was reached'), text)
  assert.ok(text.includes('narrow pattern or path and retry'), text)
})

test('the maxFiles cap truncates the walk and the summary says so', async () => {
  const tree = { 'a.txt': {}, 'b.txt': {}, 'c.txt': {} }
  const { result, text } = await globTree(tree, { pattern: '*.txt', limits: { maxFiles: 2 } })
  assert.equal(result.filesSearched, 2)
  assert.deepEqual(result.files, ['a.txt', 'b.txt'])
  assert.equal(result.truncatedFiles, true)
  assert.ok(text.includes('the maxFiles cap of 2 was reached'), text)
})

test('the maxDepth cap stops the descent and the summary names it', async () => {
  const tree = { 'a/b/c.ts': {} }
  const { result, text } = await globTree(tree, { pattern: '**/*.ts', limits: { maxDepth: 1 } })
  assert.deepEqual(result.files, [])
  assert.equal(result.depthSkipped, 1)
  assert.ok(text.includes('directories not entered past maxDepth 1: 1'), text)
})

test('a file root is a one-file candidate matched by its name', async () => {
  const root = { targetKey: 'src/index.ts', displayPath: 'src/index.ts' }
  const matching = await globTree(MAIN_TREE, { pattern: 'index.ts', root, rootType: 'file' })
  assert.deepEqual(matching.result.files, ['src/index.ts'])
  assert.equal(matching.result.filesSearched, 1)
  const missing = await globTree(MAIN_TREE, { pattern: '*.md', root, rootType: 'file' })
  assert.deepEqual(missing.result.files, [])
})

test('a search root whose own name is excluded is still walked', async () => {
  const tree = { 'node_modules/inner.ts': {} }
  const { result } = await globTree(tree, {
    pattern: '*.ts',
    root: { targetKey: 'node_modules', displayPath: 'node_modules' },
  })
  assert.deepEqual(result.files, ['node_modules/inner.ts'])
})

test('an already-aborted signal stops the walk', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => globTree(MAIN_TREE, { pattern: '*', signal: controller.signal }), /aborted/)
})

test('unsupported patterns are rejected loudly', async () => {
  for (const invalid of ['', '   ', '!*.ts', '*.{ts,tsx}', '*.ts,*.js']) {
    assert.throws(() => compileGlob(invalid), /pattern/)
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
