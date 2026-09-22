/**
 * TC-U2 —— 运行时产物完整性校验矩阵（AC-9 / FR-1.3 / spec §9.1）。
 *
 * 覆盖 `src-main/market-runtime.js` 的 `isUsableExecutable` / `isValidElf` / `isParsableJs`：
 *   - 合法 aarch64 ELF 通过；
 *   - 截断 ELF（节表越界）拒绝；
 *   - x86_64 ELF（`e_machine` 非 0xB7）拒绝；
 *   - 非 ELF（PNG magic）拒绝；
 *   - 空文件 / 不存在文件返回 false，**且绝不抛出**。
 *
 * 运行：`node --test scripts/tests/artifact-integrity.test.mjs`
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const require = createRequire(import.meta.url);
const mr = require('../../src-main/market-runtime.js');

const workDir = mkdtempSync(join(tmpdir(), 'dsh-011-integrity-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

const TARGET = { platform: 'openharmony', arch: 'arm64' };

/**
 * 构造一个结构完整的 ELF64 小端头（默认 AARCH64、节表 2 项、512 字节）。
 * 仅头部与节表范围参与校验，节内容留空。
 */
function elf64({
  machine = 0xb7,
  shoff = 0x100,
  shentsize = 64,
  shnum = 2,
  size = 512,
} = {}) {
  const buf = Buffer.alloc(size);
  buf[0] = 0x7f; buf[1] = 0x45; buf[2] = 0x4c; buf[3] = 0x46; // \x7fELF
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB
  buf[6] = 1; // EI_VERSION
  buf.writeUInt16LE(2, 16); // e_type = ET_EXEC
  buf.writeUInt16LE(machine, 18); // e_machine
  buf.writeUInt32LE(1, 20); // e_version
  buf.writeBigUInt64LE(0x400000n, 24); // e_entry
  buf.writeBigUInt64LE(0n, 32); // e_phoff
  buf.writeBigUInt64LE(BigInt(shoff), 40); // e_shoff
  buf.writeUInt32LE(0, 48); // e_flags
  buf.writeUInt16LE(64, 52); // e_ehsize
  buf.writeUInt16LE(56, 54); // e_phentsize
  buf.writeUInt16LE(0, 56); // e_phnum
  buf.writeUInt16LE(shentsize, 58); // e_shentsize
  buf.writeUInt16LE(shnum, 60); // e_shnum
  buf.writeUInt16LE(1, 62); // e_shstrndx
  return buf;
}

function writeFixture(name, bytes) {
  const file = join(workDir, name);
  writeFileSync(file, bytes);
  return file;
}

test('a complete aarch64 ELF passes structural validation', () => {
  const file = writeFixture('node-valid', elf64());
  assert.equal(mr.isValidElf(file, 'arm64', 512), true);
  if (process.platform === 'win32') {
    // Documented host behaviour: the POSIX X-bit probe is skipped on a win32
    // host, so the fixture passes without an executable bit.
    assert.equal(mr.isUsableExecutable(file, TARGET), true);
  } else {
    // On a POSIX host the same fixture has no X bit, so the strict validator
    // rejects it; setting X is the only missing piece.
    assert.equal(mr.isUsableExecutable(file, TARGET), false);
    chmodSync(file, 0o755);
    assert.equal(mr.isUsableExecutable(file, TARGET), true);
  }
});

test('a complete x86_64 ELF passes when the expected arch is x64', () => {
  const file = writeFixture('node-x64', elf64({ machine: 0x3e }));
  chmodSync(file, 0o755);
  assert.equal(mr.isUsableExecutable(file, { platform: 'linux', arch: 'x64' }), true);
});

test('a truncated ELF (section table out of bounds) is rejected', () => {
  // 头声明节表在 0x100、2 项 × 64 字节 → 需要 384 字节，但文件只有 200 字节。
  const file = writeFixture('node-truncated', elf64().subarray(0, 200));
  assert.equal(mr.isValidElf(file, 'arm64', 200), false);
  assert.equal(mr.isUsableExecutable(file, TARGET), false);
});

test('an ELF with the wrong e_machine (x86_64 vs arm64) is rejected', () => {
  const file = writeFixture('node-wrong-arch', elf64({ machine: 0x3e }));
  assert.equal(mr.isUsableExecutable(file, TARGET), false);
});

test('a non-ELF payload (PNG magic) is rejected', () => {
  const png = Buffer.alloc(512);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  const file = writeFixture('download.png', png);
  assert.equal(mr.isUsableExecutable(file, TARGET), false);
});

test('an empty file is rejected', () => {
  const file = writeFixture('node-empty', Buffer.alloc(0));
  assert.equal(mr.isUsableExecutable(file, TARGET), false);
});

test('an absent file returns false without throwing', () => {
  assert.equal(mr.isUsableExecutable(join(workDir, 'does-not-exist'), TARGET), false);
});

test('a directory path is rejected without throwing', () => {
  const dir = join(workDir, 'a-directory');
  mkdirSync(dir, { recursive: true });
  assert.doesNotThrow(() => mr.isUsableExecutable(dir, TARGET));
  assert.equal(mr.isUsableExecutable(dir, TARGET), false);
});

test('isParsableJs accepts a non-empty JS entry and rejects empty / absent ones', () => {
  const ok = writeFixture('pnpm-entry.mjs', Buffer.from('export default 1;\n', 'utf8'));
  const empty = writeFixture('pnpm-empty.mjs', Buffer.alloc(0));
  assert.equal(mr.isParsableJs(ok), true);
  assert.equal(mr.isParsableJs(empty), false);
  assert.equal(mr.isParsableJs(join(workDir, 'no-entry.mjs')), false);
});
