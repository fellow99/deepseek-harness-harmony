/**
 * Standalone harness for the build-time preset-row mirror assertion.
 *
 * `scripts/collect-dsh.mjs` runs `assertPresetRowsMirrorMainJs()` as part of a
 * full collect stage, which cannot run without a built `dsh-dist`. This harness
 * extracts the same two `HARMONY_ENSURED_PRESET_ROWS` tables (the production
 * regex, verbatim) and compares them entry by entry, so the mirror can be
 * verified in isolation. It is not wired into a test runner on purpose: it is
 * an evidence command, not shipped behavior.
 *
 * Run: `node scripts/tests/preset-rows-harness.mjs`
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..', '..')

/** Parse one source file's `HARMONY_ENSURED_PRESET_ROWS` table. */
function parseEnsuredRows(file) {
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf('const HARMONY_ENSURED_PRESET_ROWS = [')
  const end = start === -1 ? -1 : source.indexOf('\n];', start)
  if (end === -1) throw new Error(`cannot locate HARMONY_ENSURED_PRESET_ROWS in ${file}`)
  const slice = source.slice(start, end)
  return [...slice.matchAll(/\{\s*id: '([^']+)',\s*name: '([^']+)',(?:\s*requireRow: '([^']+)',)?/g)]
    .map(match => ({ id: match[1], name: match[2], requireRow: match[3] ?? null }))
}

/** Whether a file still disables the upstream `tool-bash` preset row. */
function disablesToolBash(file) {
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf('HARMONY_DISABLED_PRESET_ROWS')
  const end = source.indexOf('\n}', start)
  if (start === -1 || end === -1) return false
  return source.slice(start, end).includes("'tool-bash'")
}

const mainRows = parseEnsuredRows(resolve(projectRoot, 'src-main/main.js'))
const collectRows = parseEnsuredRows(resolve(projectRoot, 'scripts/collect-dsh.mjs'))

let failed = 0
const check = (name, condition) => {
  if (condition) {
    console.log(`ok - ${name}`)
    return
  }
  failed += 1
  console.error(`not ok - ${name}`)
}

check('row counts match between the two files', mainRows.length === collectRows.length)
check('main.js parsed 4 rows', mainRows.length === 4)
check('collect-dsh.mjs parsed 4 rows', collectRows.length === 4)
check(
  'parsed entries are identical',
  JSON.stringify(mainRows) === JSON.stringify(collectRows),
)
const execRow = mainRows.find(row => row.id === 'exec')
check('exec row exists', execRow !== undefined)
check('exec row names harmony-plugin-exec', execRow?.name === 'harmony-plugin-exec')
check('exec row requires tool-bash', execRow?.requireRow === 'tool-bash')
check(
  'main.js still disables the upstream tool-bash row',
  disablesToolBash(resolve(projectRoot, 'src-main/main.js')),
)
check(
  'collect-dsh.mjs still disables the upstream tool-bash row',
  disablesToolBash(resolve(projectRoot, 'scripts/collect-dsh.mjs')),
)

console.log(`\nmain.js   = ${JSON.stringify(mainRows)}`)
console.log(`collect   = ${JSON.stringify(collectRows)}`)
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\npreset 行互校通过（4 条与 src-main/main.js 一致）')
