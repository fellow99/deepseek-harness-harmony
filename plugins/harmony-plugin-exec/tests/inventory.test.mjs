/**
 * Unit tests for the command inventory (`lib/inventory.js`).
 *
 * The inventory is MEASURED (device `3QC0226526001227`, toybox 0.8.12, 2026-09-22) — see
 * `docs/toybox命令清单.md`. These tests pin the measured shape so it cannot silently drift
 * back to upstream guesses. Covers spec AC-17 / FR-4.1 / FR-4.2 / FR-4.6 / FR-4.7.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  A_CLASS,
  B_CLASS,
  C_CLASS,
  D_CLASS,
  DANGLING_SYMLINKS,
  EXTENDED_APPLETS,
  EXTENDED_ENABLED,
  IDENTITY_ALIAS_COUNT,
  NON_TOYBOX_SYMLINKS,
  PLATFORM_DENIED,
  RESERVED_WORDS,
  SHADOWED_BUILTINS,
  SHELL_IS_MKSH_R59,
  buildToolDescription,
} from '../lib/inventory.js'

const CLASSES = { A: A_CLASS, B: B_CLASS, C: C_CLASS, D: D_CLASS }

test('A/B/D are non-empty, C is empty here, and all classes are duplicate-free', () => {
  for (const name of ['A', 'B', 'D']) {
    assert.ok(CLASSES[name].length > 0, `${name} is empty`)
  }
  // The measured device has toybox_extended_cmd ON, so nothing is left in C.
  assert.equal(C_CLASS.length, 0)
  assert.equal(EXTENDED_ENABLED, true)
  for (const [name, list] of Object.entries(CLASSES)) {
    assert.equal(new Set(list).size, list.length, `${name} has duplicates`)
  }
})

test('the four classes are pairwise disjoint', () => {
  const entries = Object.entries(CLASSES)
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [leftName, left] = entries[i]
      const [rightName, right] = entries[j]
      const overlap = left.filter((name) => right.includes(name))
      assert.deepEqual(overlap, [], `${leftName} and ${rightName} overlap: ${overlap.join(', ')}`)
    }
  }
})

test('A-class is the measured set (177) and holds the extended applets', () => {
  assert.equal(A_CLASS.length, 177)
  for (const name of ['ls', 'cat', 'grep', 'sed', 'find', 'awk', 'diff', 'tr', 'wget', 'ipcs']) {
    assert.ok(A_CLASS.includes(name), name)
  }
  assert.deepEqual([...EXTENDED_APPLETS].sort(), ['awk', 'diff', 'expr', 'getfattr', 'ipcs', 'telnet', 'tr', 'traceroute', 'traceroute6', 'wget'])
  for (const name of EXTENDED_APPLETS) assert.ok(A_CLASS.includes(name), `extended ${name} must be A-class here`)
})

test('B-class is EXACTLY [nc] as measured (not the 18 upstream guesses)', () => {
  assert.deepEqual([...B_CLASS], ['nc'])
  assert.ok(!B_CLASS.includes('netcat'))
  assert.ok(!B_CLASS.includes('reboot'), 'reboot is NOT a toybox applet — it links to begetctl')
})

test('D-class carries the tools that genuinely do not exist', () => {
  for (const name of ['bash', 'busybox', 'git']) assert.ok(D_CLASS.includes(name), name)
})

test('dangling symlinks are recorded and kept out of A/B', () => {
  assert.equal(DANGLING_SYMLINKS.length, 42)
  for (const name of ['acpi', 'bzcat', 'bunzip2', 'halt']) {
    assert.ok(DANGLING_SYMLINKS.includes(name), name)
    assert.ok(!A_CLASS.includes(name), `${name} must not be claimed as callable`)
    assert.ok(!B_CLASS.includes(name), `${name} is not a toybox-only applet`)
  }
})

test('non-toybox symlinks are recorded with their targets, reboot among them', () => {
  const map = new Map(NON_TOYBOX_SYMLINKS)
  assert.equal(map.get('reboot'), 'begetctl')
  assert.equal(map.get('service_control'), 'begetctl')
  assert.equal(map.get('resize.f2fs'), 'fsck.f2fs')
  assert.ok(!A_CLASS.includes('reboot'), 'reboot must never be advertised as a toybox applet')
})

test('the shell is mksh R59 and the shadow set is the MEASURED one', () => {
  assert.equal(SHELL_IS_MKSH_R59, true)
  assert.equal(IDENTITY_ALIAS_COUNT, 130)
  assert.deepEqual(
    [...SHADOWED_BUILTINS].sort(),
    ['cat', 'echo', 'false', 'kill', 'pwd', 'realpath', 'sleep', 'test', 'true', 'ulimit'],
  )
  assert.deepEqual([...RESERVED_WORDS], ['time'])
  // The earlier revision wrongly listed printf; measurement shows it resolves via PATH.
  assert.ok(!SHADOWED_BUILTINS.includes('printf'), 'printf is NOT a shell builtin here')
})

test('chmod/chown are A-class but marked platform-denied in the app domain', () => {
  assert.deepEqual([...PLATFORM_DENIED], ['chmod', 'chown'])
  assert.ok(A_CLASS.includes('chmod'))
  assert.ok(A_CLASS.includes('chown'))
})

test('the description discloses the classes, the TRAP and the non-toybox danger', () => {
  const d = buildToolDescription()
  for (const marker of [
    'A (directly callable',
    'B (compiled but NOT on PATH',
    'The extended (build-flag-gated) applets ARE compiled here',
    '- D (does not exist)',
    'TRAP:',
    'command -v',
  ]) {
    assert.ok(d.includes(marker), marker)
  }
  assert.ok(d.includes('begetctl'), 'the reboot->begetctl danger must be surfaced')
  assert.ok(d.includes('13900012'))
  assert.ok(d.includes('chmod'))
  assert.ok(d.includes('chown'))
  assert.ok(d.includes('mksh R59'), 'the measured shell identity must be stated (FR-4.6)')
  assert.ok(!d.includes('unresolved'), 'the sh identity is no longer unresolved')
})

test('the description discloses the non-PTY resident backend, the fence, and substitutes limits', () => {
  const d = buildToolDescription({ commandTimeoutMs: 1234, maxCommandChars: 99, maxOutputBytes: 77 })
  assert.ok(d.includes('NON-PTY'))
  assert.ok(d.includes('persist ACROSS calls'))
  assert.ok(d.includes('Exit code:'))
  assert.ok(d.includes('BEST-EFFORT'))
  assert.ok(d.includes('BYPASSABLE'))
  assert.ok(d.includes('1234'))
  assert.ok(d.includes('99'))
  assert.ok(d.includes('77'))
  assert.ok(!d.includes('@@'), 'no unsubstituted placeholder may remain')
})
