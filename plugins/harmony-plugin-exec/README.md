[中文](./README_zh.md) | English

---

# harmony-plugin-exec

Model-facing `bash` command-execution tool for DeepSeek Harness on HarmonyOS, backed by one **non-PTY resident `/system/bin/sh`** driven by a sentinel-line protocol.

## Purpose

The upstream `tool-bash` preset row is disabled on this wrapper: its backend chain (`ctx.shell` → `bash-local`/`bash-sandbox` → `ctx.subprocess` → `node-pty`) cannot load, because `node-pty` ships as a win32-x64 binary and the platform has no application-level PTY API. This plugin restores command execution as a **project-specific plugin** — it does not re-enable any upstream layer.

The platform makes two facts unavoidable, and this plugin is built around them:

| Fact (device-measured) | Consequence |
|---|---|
| A spawned child's `proc:exit` / `proc:close` **never fire**; the child becomes a zombie. | Completion cannot come from a lifecycle event. The shell prints a random-token BEGIN marker before a command and a random-token END marker carrying `$?` after it; the parser treats the END line as the only completion signal (`lib/protocol.js`). |
| Every spawn leaks exactly one zombie. | One long-lived shell is spawned lazily and reused; every command does **not** spawn. A reset (kill + respawn) is a last resort that leaks one zombie by design. |

`child_process.exec` / `execFile` are never used (they never call back), `process.execPath` is never a spawn target (its path is `ENOENT`), and executability is never probed with `statSync` (`EACCES` false negative).

## Tool contract

| Aspect | Value |
|---|---|
| Tool name | `bash` (kept for continuity with the upstream identity; the non-PTY backend is disclosed in the description) |
| Parameters | `command` (required), `timeout_ms` (optional, only lowers the cap), plus `sandbox_permissions` / `justification` **only** when a confining filesystem backend is mounted |
| Result | A single text block: `Exit code: <rc>` then the command output, followed by optional `[output truncated: kept N of M bytes]`, `[command cancelled]`, `[command timed out after Nms]`, `[session reset: …]` lines |
| Non-zero exit | A normal result (`Exit code: 1`), never a tool error. Only a fence denial, an unrecoverable timeout, or an unusable session is an error. |
| State | The shell is resident, so `cd` and shell variables persist **across calls** (deliberate; the description tells the model). |

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `commandTimeoutMs` | `120000` | Per-call wall-clock cap (including the drain). |
| `maxOutputBytes` | `262144` | Bytes retained from one command; the stream still drains to the sentinel, and `totalBytes` reports the true size. |
| `maxCommandChars` | `65536` | Command-string length cap, enforced before dispatch. |
| `fenceMode` | `enforce` | `enforce` denies fail-closed; `warn` logs and allows; `off` skips analysis. `warn` / `off` are explicit security downgrades and are announced at startup with the `[dsh-harmony]` prefix. |
| `commandPolicy` | `disclose-only` | `disclose-only` checks no command names; `allowlist` allows only listed names; `denylist` is currently **equivalent to `disclose-only`** — `denyCommands` is applied in both, so `denylist` adds no protection beyond the deny list. |
| `shellPath` | `/system/bin/sh` | The resident shell executable. Only known-spawnable targets (`/system/bin/sh`, `/bin/sh`, `/system/bin/toybox`) have been verified; no `statSync` probe is used. |
| `allowCommands` | `[]` | Allowlist used by `commandPolicy: allowlist`. |
| `denyCommands` | system/hardware verbs | Default deny list (see FR-4.5): `reboot reset mount umount swapon swapoff mkswap insmod rmmod modinfo devmem i2cdetect i2cdump i2cget i2cset i2ctransfer chroot pivot_root switch_root nsenter unshare`. Applied even under `disclose-only`. |
| `toyboxApplets` | the B-class set | Allowlist-mode whitelist for `toybox <applet>` passthrough (spec FR-4.4). |

All three numeric limits are validated in `apply` as positive safe integers; an invalid value fails the composition.

```yaml
- name: harmony-plugin-exec
  config:
    commandTimeoutMs: 120000
    maxOutputBytes: 262144
    fenceMode: enforce
    commandPolicy: disclose-only
```

## Command reachability

Four classes, not interchangeable (spec §2.3 / FR-4.1):

| Class | Meaning | Examples | Call as |
|---|---|---|---|
| **A** | Symlinked into `/system/bin`; the bare name resolves. | `ls cat grep sed cp mv rm find xargs sort ps kill date env id uname which` … | `ls` |
| **B** | Compiled but not symlinked; the bare name is **not** on PATH. | `nc netcat base32 blkid route reboot sha224sum sha512sum unicode getty mdev …` | `toybox nc` |
| **C** | Gated by `toybox_extended_cmd` (default `false`); **availability `未验证`**. | `awk wget diff expr getfattr ipcs telnet traceroute traceroute6 tr` | confirm with `toybox --long` first |
| **D** | Not compiled into this platform. | `bash busybox fdisk fsck vi man strace bc hexdump` and GNU coreutils generally | ❌ |

`chmod` / `chown` are A-class (present on PATH) but the platform refuses their effect at runtime (`13900012 Permission denied`), so permission bits cannot be changed.

## Path fence

Before dispatch, `lib/fence.js` tokenizes the command (single quotes, double quotes, and backslash escapes respected; no variable expansion, no globs) and judges:

- literal path tokens: any token containing `/`, starting with `.` or `~`, or **any redirect target** (`>`, `>>`, `<`, `<>`);
- paths are normalized lexically against the session `cwd` (no filesystem access, no symlink resolution);
- the allowed roots are the session `cwd` plus `DSH_EXTRA_WRITABLE_ROOTS`;
- unanalyzable constructs (`$VAR`, `$(...)`, backticks, `eval`, `env`, `xargs`, `find -exec`, nested `sh -c`) are refused fail-closed under `enforce`.

**Order is fixed:** the fence decides first. A denied command with no escalation fields is rejected with the shared `[sandbox: …]` marker and never prompts the user; only a retry carrying `sandbox_permissions` + `justification` reaches one approval.

## What the model sees

**Tool result** (spec FR-2.3): a single text block beginning with `Exit code: <rc>` and containing the command output, optionally followed by the truncation, cancellation, timeout, and session-reset notices. The description carries the A/B/C/D classification, the platform-denied `chmod`/`chown`, and the non-PTY / persistent-cwd facts.

**Errors.** A fence denial is an `Error` whose text is the shared denial marker (when a confining backend is present) plus the reason and, when escalation is available, the escalation hint. An invalid argument (`command` empty or too long, `timeout_ms` not a positive integer, a malformed escalation pairing) is a plain error before anything runs. A spawn failure is loud and names `shellPath`.

## Known Limitations

- **The fence is best-effort and bypassable — it is NOT a sandbox.** Variable expansion (`X=/data; ls $X`), command substitution (`ls $(printf /data)`), backticks, a nested `sh -c '…'`, `eval`/`env`/`xargs`, and tools that read a path from a config file or environment can all move a real path out of sight of a token-level check. The fence raises cost and visibility; it does not constitute a security boundary (spec §6.4).
- **The shell runs with the application's own uid and full file access.** The filesystem sandbox and approval system have no authority over a shell child; this plugin's fence is the only tool-layer check and cannot replace a kernel sandbox (spec FR-6.4 / §6.1).
- **The platform's symlink denial is a mitigation, not a guarantee.** `ln -s` has been observed to fail, which lowers the risk of disguising an out-of-root path as an in-root one, but platform behaviour can change and does not cover the non-symlink bypasses above (spec FR-3.8).
- **C-class commands are `未验证`.** Whether `awk` / `wget` / `diff` / `expr` / `tr` / … are compiled is controlled by `toybox_extended_cmd` (default `false`), and the OpenHarmony documentation is a superset — "documented" does not mean "compiled". Run `toybox --long` on the device before relying on them (spec FR-4.2 / AC-27).
- **The `/system/bin/sh` identity is SETTLED: mksh R59 (2020/10/31), NOT toysh.** Device md5 comparison on 2026-09-22: `/system/bin/sh` = `5b5e8eb9…` vs `/system/bin/toybox` = `19f83712…` (different binaries), with `KSH_VERSION=@(#)MIRBSD KSH R59 2020/10/31`. ⚠️ **Two probes lie here and must not be used:** `readlink /proc/self/exe` misreports `/system/bin/toybox`, and the trailing `Toybox` in `uname -a` is a kernel utsname string. **Exactly these names are intercepted by the shell** (so the bare name does NOT run the toybox applet): builtins `cat echo false kill pwd realpath sleep test true ulimit`, plus reserved word `time`. `printf`, `ls`, `grep`, `sed` are **not** intercepted. Write `toybox <name>` to force toybox. Also note mksh ships 130 identity aliases, so `command -v cat` prints `alias cat=cat`, not a path. Full per-command evidence: `docs/toybox命令清单.md` (spec FR-4.6 / AC-26).
- **One resident shell, one cwd.** Because `cd` persists, every `bash` call in the plugin instance shares the cwd of the session that spawned the shell first; there is no per-call `workdir` parameter (spec FR-1.7 / FR-6.6).
- **No PTY and no TTY.** Interactive programs (`top`, pagers, editors) have unknown behaviour and are `未验证`; the description steers toward non-interactive forms (spec FR-2.6).
- **Every reset leaks one zombie.** Resets are limited to stdout close and a failed drain, but they are not free; the plugin never resets per command (spec FR-6.3).
- **Serial only.** One command is in flight at a time; concurrent calls queue (spec FR-5.6).
- **Output is truncated to the first `maxOutputBytes`.** Later bytes are read (to keep the session synchronized) but not returned; the notice reports the kept and total sizes (spec FR-5.4).
- **A timeout may report an unknown exit code.** If the sentinel never arrives before the drain budget expires, the session is reset and `Exit code: unknown` is reported — never a faked `0` (spec FR-5.5).
- **The escalation path is vocabulary-faithful but not confinement.** With no confining backend mounted the escalation fields are absent; when one is mounted the shared approval sequence runs, but a granted mode does not actually confine a shell child. Prefer `fenceMode: enforce`.
- **An unbalanced quote swallows the closing framing.** The wrapper's closing `}`, `__dsh_rc=$?` and END marker only run if the command is syntactically closed; an unterminated quote makes the shell absorb them into the command, so the sentinel never arrives and the call burns its full timeout plus drain budget before the session resets and recovers.

## Dependencies

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-tools`, and `@deepseek-ai/schemastery` are declared as `peerDependencies` and supplied by the consuming build at runtime; they ship inside `dsh-dist/node_modules`, so the plugin is not published and carries no bundled or installed dependency of its own. Plain ESM, no build step — `lib/` is the shipped source. `lib/protocol.js`, `lib/fence.js`, and `lib/inventory.js` import nothing at all.

The only runtime dependency beyond the dsh packages is the platform's own `/system/bin/sh`; no native module, PTY, or subprocess capability is added.

## Tests

`npm test` (or `node --test tests/*.test.mjs`) runs four files on plain Node, no device and no dsh package required:

| File | Covers |
|---|---|
| `tests/protocol.test.mjs` | Framing text, BEGIN/END capture, byte fidelity, NUL, one-byte chunking, token-mismatch rejection, exit codes, truncation |
| `tests/fence.test.mjs` | Tokenizer, path candidates, normalization, root boundaries, redirect targets, unanalyzable constructs, the three modes, allowlist + `toybox` passthrough, deny list |
| `tests/inventory.test.mjs` | Four disjoint classes, key members, `未验证` disclosure, `chmod`/`chown` platform denial, description content |
| `tests/session.test.mjs` | Resident session driven through an injected fake `spawn`: serialization, truncation, timeout → drain → reset, cancellation, stdout-close liveness, spawn failure, disposal |

The session test uses the injected `spawn` seam, so the device-dependent paths are exercised without a device. Anything requiring the real `/system/bin/sh` stays `未验证` and is listed in `specs/010-tool-bash/test-cases.md` §3.
