/**
 * TC-U1 / TC-U3 / TC-U4 —— 运行时选路、PATH / PNPM_HOME 组装、shim 内容与诊断文本
 * （AC-3 / AC-10 / AC-11 / AC-12 / AC-15 / AC-18）。
 *
 * 全部通过注入依赖驱动 `src-main/market-runtime.js` 的**纯函数**，不需 Electron、不需 dsh、
 * 不需真实设备。宿主 win32 下目标平台固定为 `openharmony`，因此路径一律以 POSIX 形态断言。
 *
 * 运行：`node --test scripts/tests/market-runtime.test.mjs`
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const mr = require('../../src-main/market-runtime.js');

const BASE = {
  platform: 'openharmony',
  arch: 'arm64',
  env: {},
  userData: '/u',
  dshRoot: '/u/dsh-dist',
  home: '/home/user',
};

/** 默认桩：所有候选都不存在。逐个用例覆盖需要的探测点。 */
function deps(overrides = {}) {
  return {
    ...BASE,
    exists: () => false,
    isUsableExecutable: () => false,
    isExecutableFile: () => false,
    isParsableJs: () => false,
    probeNodeExec: () => false,
    ...overrides,
  };
}

// ── 选路（A → B → C → 显式失败，禁跳级） ─────────────────────────────

test('path A is selected when both HNP node and pnpm pass structural validation', () => {
  const result = mr.discoverMarketRuntime(deps({
    exists: () => true,
    isUsableExecutable: () => true,
  }));
  assert.equal(result.path, 'A');
  assert.equal(result.ok, true);
  assert.equal(result.source, 'bundled-hnp');
  assert.equal(result.deviceEnvironment, false);
  assert.equal(result.shim, true);
  assert.deepEqual(result.dirs, ['/u/runtime-bin', '/data/service/hnp/bin']);
  assert.equal(result.pnpmHome, '/data/service/hnp/bin');
  assert.equal(result.nodeFile, '/data/service/hnp/bin/node');
  assert.equal(result.pnpmFile, '/data/service/hnp/bin/pnpm');
});

test('path B is selected when path A is unavailable and the pnpm JS entry is in place', () => {
  const result = mr.discoverMarketRuntime(deps({
    // 只有 HNP 的 node 通过严格校验，pnpm 不通过 → 路径 A 整体不可用
    exists: () => true,
    isUsableExecutable: (file) => file.endsWith('/node'),
    isParsableJs: () => true,
  }));
  assert.equal(result.path, 'B');
  assert.equal(result.source, 'in-process');
  assert.equal(result.deviceEnvironment, false);
  assert.equal(result.shim, false, 'path B has no exec-able node, so no shim is generated');
  assert.equal(result.pnpmHome, null);
  assert.deepEqual(result.dirs, ['/u/runtime-bin']);
  assert.equal(result.pnpmJsEntry, '/u/dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs');
});

test('path C is selected only when A and B are unavailable and the node -e probe passes', () => {
  const result = mr.discoverMarketRuntime(deps({
    exists: () => true,
    isExecutableFile: () => true,
    probeNodeExec: () => true,
  }));
  assert.equal(result.path, 'C');
  assert.equal(result.source, 'device-environment');
  assert.equal(result.deviceEnvironment, true);
  assert.equal(result.shim, true);
  assert.deepEqual(result.dirs, ['/u/runtime-bin', '/data/service/hnp/bin']);
  assert.equal(result.pnpmHome, '/data/service/hnp/bin');
});

test('path C is NOT selected when the node -e probe produces no output', () => {
  const result = mr.discoverMarketRuntime(deps({
    exists: () => true,
    isExecutableFile: () => true,
    probeNodeExec: () => false,
  }));
  assert.equal(result.path, null);
  assert.equal(result.ok, false);
});

test('degradation is ordered and never skips a level: an available A beats a probe-passing C', () => {
  const result = mr.discoverMarketRuntime(deps({
    exists: () => true,
    isUsableExecutable: () => true,
    isExecutableFile: () => true,
    probeNodeExec: () => true,
  }));
  assert.equal(result.path, 'A');
});

test('an available B beats a probe-passing C', () => {
  const result = mr.discoverMarketRuntime(deps({
    exists: () => true,
    isUsableExecutable: () => false,
    isParsableJs: () => true,
    isExecutableFile: () => true,
    probeNodeExec: () => true,
  }));
  assert.equal(result.path, 'B');
});

test('when everything is unavailable the result is an explicit failure, not an exception', () => {
  const result = mr.discoverMarketRuntime(deps());
  assert.equal(result.path, null);
  assert.equal(result.ok, false);
  assert.equal(result.deviceEnvironment, false);
  assert.deepEqual(result.dirs, [], 'a failed discovery must not prepend any dir to PATH');
  assert.match(result.reason, /市场安装通道不可用/);
  assert.match(result.reason, /二进制证书/);
});

test('path C `~` candidate expansion honours the injected platform (POSIX shape)', () => {
  const result = mr.discoverMarketRuntime(deps({
    home: '/home/user',
    deviceNodeDirs: ['~/.local/bin'],
    exists: () => true,
    isExecutableFile: () => true,
    probeNodeExec: () => true,
  }));
  assert.equal(result.path, 'C');
  assert.deepEqual(result.dirs, ['/u/runtime-bin', '/home/user/.local/bin']);
});

// ── PATH 顺序 / 去重 / 空项（AC-10） ─────────────────────────────────

test('composePath prepends prefix dirs in order, dedupes, and drops empty entries', () => {
  assert.equal(
    mr.composePath(['/bin', '/pnpm', '/node'], '/node:/usr/bin', 'linux'),
    '/bin:/pnpm:/node:/usr/bin',
  );
  assert.equal(mr.composePath(['/bin', '', null, '/bin'], '/bin:/x', 'linux'), '/bin:/x');
  assert.equal(mr.composePath([], '', 'linux'), '');
});

test('composePath uses the platform separator', () => {
  assert.equal(mr.composePath(['C:\\a'], 'C:\\a;C:\\b', 'win32'), 'C:\\a;C:\\b');
});

// ── PNPM_HOME（AC-11）: covered by path A assertion above ─────────────

// ── shim 内容（AC-12） ───────────────────────────────────────────────

test('POSIX shim content is exactly the exec form', () => {
  const content = mr.dshShim(
    '/data/service/hnp/bin/node',
    '/data/storage/el2/base/files/.dsh/dsh-dist',
    'openharmony',
  );
  assert.equal(
    content,
    '#!/bin/sh\nexec "/data/service/hnp/bin/node" "/data/storage/el2/base/files/.dsh/dsh-dist/lib/bin.js" "$@"\n',
  );
});

test('Windows shim content is exactly the cmd form', () => {
  const content = mr.dshShim('C:\\app\\node.exe', 'C:/app/dsh-dist', 'win32');
  assert.equal(
    content,
    '@echo off\r\n"C:\\app\\node.exe" "C:\\app\\dsh-dist\\lib\\bin.js" %*\r\nexit /b %errorlevel%\r\n',
  );
});

// ── 诊断文本（AC-18 / FR-6.1，禁静默降级） ───────────────────────────

test('diagnostics are prefixed and record which path was selected', () => {
  const ok = mr.discoverMarketRuntime(deps({ exists: () => true, isUsableExecutable: () => true }));
  const lines = mr.formatDiagnostics(ok);
  assert.ok(lines.length > 0);
  for (const line of lines) assert.ok(line.startsWith('[dsh-harmony] '), line);
  assert.ok(lines.some((line) => line.includes('采用路径 A')), 'must record the selected path');
  assert.ok(lines.some((line) => line.includes('二进制证书')), 'path A must name its certificate blocker');
  assert.ok(!lines.some((line) => line.includes('device-environment')), 'A must not be labelled device-environment');
});

test('path C diagnostics carry the device-environment marker; A and B do not', () => {
  const c = mr.discoverMarketRuntime(deps({
    exists: () => true,
    isExecutableFile: () => true,
    probeNodeExec: () => true,
  }));
  const cLines = mr.formatDiagnostics(c);
  assert.ok(cLines.some((line) => line.includes('device-environment')), 'C must be labelled device-environment');
  assert.ok(cLines.some((line) => line.includes('非本应用保障')));

  const b = mr.discoverMarketRuntime(deps({ exists: () => true, isParsableJs: () => true }));
  assert.ok(!mr.formatDiagnostics(b).some((line) => line.includes('device-environment')));
});

test('explicit failure diagnostics are loud and actionable', () => {
  const failed = mr.discoverMarketRuntime(deps());
  const lines = mr.formatDiagnostics(failed);
  assert.ok(lines.some((line) => line.includes('runtime 不可用')), 'failure must be logged, not silent');
  assert.ok(lines.some((line) => line.includes('市场安装通道不可用')));
});

test('candidate diagnostics record rejected candidates and why', () => {
  // 全部不可用时探测才会走遍 A/B/C，逐条记录拒绝原因（选中即短路，属预期）。
  const result = mr.discoverMarketRuntime(deps());
  const text = result.diagnostics.join('\n');
  assert.match(text, /路径 A/);
  assert.match(text, /路径 B/);
  assert.match(text, /路径 C/);
  assert.match(text, /物化进 dsh-dist/);
});
