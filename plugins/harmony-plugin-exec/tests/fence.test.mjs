/**
 * Unit tests for the token-level path fence (`lib/fence.js`).
 *
 * Runs on plain Node; the module is import-free. Covers the fence rows of
 * `specs/010-tool-bash/test-cases.md` §2 (TC-U4..TC-U6) and spec
 * AC-9/AC-10/AC-18/AC-19 — the decision face of AC-11 (fence-before-approval).
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_DENY_COMMANDS,
  check,
  extractPathTokens,
  isWithinRoots,
  normalizePath,
  tokenize,
} from '../lib/fence.js'

const CWD = '/ws'
const ROOTS = [CWD]

/** Run the fence with the common test defaults overridden per case. */
function decide(command, overrides = {}) {
  return check({ command, cwd: CWD, roots: ROOTS, ...overrides })
}

test('tokenize respects single quotes, double quotes, and backslash escapes', () => {
  assert.deepEqual(tokenize("echo 'a b'").map(token => token.value), ['echo', 'a b'])
  assert.deepEqual(tokenize('echo "a b"').map(token => token.value), ['echo', 'a b'])
  assert.deepEqual(tokenize('echo a\\ b').map(token => token.value), ['echo', 'a b'])
})

test('extractPathTokens picks slash, dot, tilde, and redirect targets', () => {
  const tokens = tokenize('echo x > /etc/a 2>> out.txt < in.txt')
  const values = extractPathTokens(tokens).map(candidate => candidate.value)
  assert.ok(values.includes('/etc/a'))
  assert.ok(values.includes('out.txt'))
  assert.ok(values.includes('in.txt'))
  assert.ok(extractPathTokens(tokenize('cat ./rel')).some(candidate => candidate.value === './rel'))
  assert.ok(extractPathTokens(tokenize('cat ~/x')).some(candidate => candidate.value === '~/x'))
})

test('normalizePath resolves lexically against cwd and refuses ~', () => {
  assert.equal(normalizePath('/ws/a', CWD), '/ws/a')
  assert.equal(normalizePath('a/b', CWD), '/ws/a/b')
  assert.equal(normalizePath('../etc', CWD), '/etc')
  assert.equal(normalizePath('./a/../b', CWD), '/ws/b')
  assert.equal(normalizePath('~/x', CWD), null)
})

test('isWithinRoots is separator-aware and never matches a sibling prefix', () => {
  assert.equal(isWithinRoots('/a/b', ['/a/b']), true)
  assert.equal(isWithinRoots('/a/b/c', ['/a/b']), true)
  assert.equal(isWithinRoots('/a/bc', ['/a/b']), false)
})

test('in-root literal paths are allowed; out-of-root literals are denied', () => {
  assert.equal(decide('cat /ws/a').decision, 'allow')
  assert.equal(decide('cat /etc/passwd').decision, 'deny')
})

test('a .. that normalizes out of the root is denied', () => {
  assert.equal(decide('cat /ws/../etc/passwd').decision, 'deny')
})

test('redirect targets participate in the same judgement (FR-3.5)', () => {
  assert.equal(decide('echo x > /etc/y').decision, 'deny')
  assert.equal(decide('echo x > /ws/y').decision, 'allow')
})

test('a root boundary is not confused with a sibling prefix', () => {
  assert.equal(check({ command: 'cat /a/bc', cwd: '/', roots: ['/a/b'] }).decision, 'deny')
})

test('a selectable deny list covers the default system/hardware verbs', () => {
  for (const command of ['reboot', 'mount -t tmpfs none /mnt', 'devmem 0x1', 'i2cset 1 2 3 4']) {
    assert.equal(decide(command).decision, 'deny', command)
  }
  assert.ok(DEFAULT_DENY_COMMANDS.includes('pivot_root'))
})

test('unanalyzable constructs are refused under enforce', () => {
  const cases = [
    'X=/etc; ls $X',
    'ls ${HOME}',
    'ls $(printf /etc)',
    'ls `pwd`',
    'eval true',
    'sh -c true',
    '/system/bin/sh -c "ls /etc"',
    'xargs ls',
    'find . -exec ls {} ;',
  ]
  for (const command of cases) {
    const verdict = decide(command)
    assert.notEqual(verdict.decision, 'allow', command)
    assert.ok(verdict.decision === 'deny' || verdict.decision === 'unanalyzable', command)
  }
})

test('an ordinary command is not misjudged as unanalyzable', () => {
  assert.equal(decide('echo hello').decision, 'allow')
})

test('warn and off downgrade a denial to an explicit skip', () => {
  const warn = decide('cat /etc/passwd', { mode: 'warn' })
  assert.equal(warn.decision, 'skipped')
  assert.equal(warn.verdict, 'deny')
  assert.match(warn.reason, /warn/)
  const off = decide('cat /etc/passwd', { mode: 'off' })
  assert.equal(off.decision, 'skipped')
  assert.match(off.reason, /off/)
})

test('allowlist refuses unlisted commands and permits listed ones', () => {
  const allowCommands = new Set(['ls'])
  assert.equal(decide('ls -la', { commandPolicy: 'allowlist', allowCommands }).decision, 'allow')
  assert.equal(decide('cat /ws/a', { commandPolicy: 'allowlist', allowCommands }).decision, 'deny')
})

test('allowlist does not let toybox passthrough bypass it (FR-4.4)', () => {
  const base = { commandPolicy: 'allowlist', allowCommands: new Set(['toybox']) }
  const toyboxApplets = new Set(['nc', 'netcat'])
  assert.equal(decide('toybox nc -l', { ...base, toyboxApplets }).decision, 'allow')
  assert.equal(decide('toybox chmod 777 /ws/a', { ...base, toyboxApplets }).decision, 'deny')
  assert.equal(decide('toybox', { ...base, toyboxApplets }).decision, 'deny')
})

test('a caller-supplied deny set replaces the default', () => {
  const denyCommands = new Set(['frobnicate'])
  assert.equal(decide('frobnicate /ws/a', { denyCommands }).decision, 'deny')
  assert.equal(decide('reboot', { denyCommands }).decision, 'allow')
})

test('a denied verb in a later command position is still refused (compound bypass)', () => {
  const cases = [
    ['ls; reboot', 'deny'],
    ['ls | reboot', 'deny'],
    ['echo a && devmem 0x1', 'deny'],
    ['ls || mount -t tmpfs none /mnt', 'deny'],
    ['ls | xargs rm /ws/a', 'unanalyzable'],
    ['echo hi; eval rm /ws/a', 'unanalyzable'],
    ['echo hi | sh -c rm', 'unanalyzable'],
    ["echo hi | sh -c'rm'", 'unanalyzable'],
    ['find /ws -execdir rm {} ;', 'unanalyzable'],
  ]
  for (const [command, expected] of cases) {
    assert.equal(decide(command).decision, expected, command)
  }
})

test('compound-command hardening does not over-block in-root commands', () => {
  assert.equal(decide('cat /ws/ok').decision, 'allow')
  assert.equal(decide('cat /ws/ok; echo done').decision, 'allow')
  assert.equal(decide('cat /ws/ok && ls | sort').decision, 'allow')
  assert.equal(decide('cat /etc/passwd').decision, 'deny')
  assert.equal(decide('echo hi; cat /etc/passwd').decision, 'deny')
})
