/**
 * Command-reachability inventory and the model-facing capability disclosure.
 *
 * Deliberately import-free so `node:test` drives it on bare Node.
 *
 * **MEASURED, not inferred.** Every list below comes from per-command probing on device
 * `3QC0226526001227` (HarmonyOS 6.1.0.135 / API 24, toybox 0.8.12) on 2026-09-22 — see
 * `docs/toybox命令清单.md` and the raw evidence under `logs/20260922-1/toybox-probe/`.
 * The previous version was written from upstream inference and was WRONG: it claimed 18
 * B-class applets (measured: `nc` alone) and left the extended applets `未验证` (measured:
 * compiled and usable). Do not "simplify" these lists back into guesses.
 *
 * Reachability classes plus two measured-only anomaly classes:
 *
 * - **A** — symlinked to `toybox` AND compiled: the bare name resolves.
 * - **B** — compiled but NOT symlinked: only `toybox <n>` reaches it.
 * - **C** — gated by `toybox_extended_cmd`. EMPTY here (the flag is ON, so those applets are
 *   in {@link A_CLASS}); kept for builds where the flag is off.
 * - **D** — not present at all.
 * - {@link DANGLING_SYMLINKS} — a `/system/bin` symlink to `toybox` whose applet is NOT
 *   compiled: the bare name fails with `toybox: Unknown command`. The trap — `ls` and
 *   `command -v` report them as available.
 * - {@link NON_TOYBOX_SYMLINKS} — symlinks to OTHER programs. `reboot` is one, and it really
 *   reboots the device (measured the hard way).
 *
 * @module harmony-plugin-exec/inventory
 */

/**
 * A-class: symlinked into `/system/bin` **and** compiled, so the bare name resolves.
 * 177 entries as measured. For {@link SHADOWED_BUILTINS} / {@link RESERVED_WORDS} the
 * bare form runs the SHELL's implementation instead of the applet.
 */
export const A_CLASS = Object.freeze([
  'awk', 'base64', 'basename', 'cal', 'cat', 'chcon', 'chgrp', 'chmod', 'chown', 'chroot',
  'chvt', 'cksum', 'clear', 'cmp', 'comm', 'count', 'cp', 'cpio', 'crc32', 'cut', 'date', 'dd',
  'df', 'diff', 'dirname', 'dmesg', 'dos2unix', 'du', 'echo', 'egrep', 'env', 'expand', 'expr',
  'factor', 'fallocate', 'false', 'fgrep', 'file', 'find', 'flock', 'fmt', 'free',
  'freeramdisk', 'fstype', 'fsync', 'ftpget', 'ftpput', 'getconf', 'getfattr', 'grep',
  'groups', 'gunzip', 'gzip', 'head', 'help', 'hexedit', 'hostname', 'iconv', 'id', 'ifconfig',
  'inotifyd', 'insmod', 'install', 'iotop', 'ipcs', 'kill', 'killall', 'link', 'ln', 'logname',
  'ls', 'lsattr', 'lsmod', 'lsof', 'lspci', 'lsusb', 'mcookie', 'md5sum', 'mkdir', 'mkfifo',
  'mknod', 'mkpasswd', 'mkswap', 'mktemp', 'more', 'mount', 'mountpoint', 'mv', 'netcat',
  'netstat', 'nice', 'nl', 'nohup', 'nproc', 'nsenter', 'od', 'paste', 'patch', 'pgrep',
  'pidof', 'ping', 'ping6', 'pkill', 'printenv', 'printf', 'prlimit', 'ps', 'pwd', 'pwdx',
  'readahead', 'readlink', 'realpath', 'renice', 'reset', 'rev', 'rm', 'rmdir', 'rmmod',
  'route', 'sed', 'seq', 'setfattr', 'setsid', 'sha1sum', 'sha256sum', 'sha384sum',
  'sha512sum', 'shred', 'sleep', 'sort', 'split', 'stat', 'strings', 'swapoff', 'swapon',
  'sync', 'sysctl', 'tac', 'tail', 'tar', 'taskset', 'tee', 'telnet', 'test', 'time',
  'timeout', 'top', 'touch', 'tr', 'traceroute', 'traceroute6', 'true', 'truncate', 'tty',
  'ulimit', 'umount', 'uname', 'uniq', 'unix2dos', 'unlink', 'uptime', 'usleep', 'uudecode',
  'uuencode', 'uuidgen', 'vmstat', 'w', 'watch', 'wc', 'wget', 'which', 'who', 'whoami',
  'xargs', 'xxd', 'yes', 'zcat',
])

/**
 * B-class: compiled but NOT symlinked — only `toybox <name>` reaches it. Measured membership
 * is exactly one applet. Doubles as the allowlist-mode whitelist for the `toybox` passthrough
 * (spec FR-4.4).
 */
export const B_CLASS = Object.freeze([
  'nc',
])

/** C-class: gated by `toybox_extended_cmd`. EMPTY on the measured device (the flag is ON). */
export const C_CLASS = Object.freeze([])

/** D-class: does not exist on this platform (spec FR-4.1). */
export const D_CLASS = Object.freeze([
  'bash', 'busybox', 'vi', 'man', 'strace', 'bc', 'fdisk', 'fsck', 'git', 'crond',
])

/** True when the extended applets measured as compiled ({@link EXTENDED_APPLETS}). */
export const EXTENDED_ENABLED = true

/** Extended (flag-gated) applets that measured as available — hence A-class here. */
export const EXTENDED_APPLETS = Object.freeze([
  'awk', 'diff', 'expr', 'getfattr', 'ipcs', 'telnet', 'traceroute', 'traceroute6', 'tr',
  'wget',
])

/**
 * Broken symlinks: `readlink /system/bin/<n>` says `toybox` but the applet is not compiled.
 * 42 entries as measured.
 */
export const DANGLING_SYMLINKS = Object.freeze([
  'acpi', 'arch', 'ascii', 'blockdev', 'bunzip2', 'bzcat', 'chattr', 'chrt', 'devmem',
  'dnsdomainname', 'eject', 'fsfreeze', 'halt', 'hwclock', 'i2cdetect', 'i2cdump', 'i2cget',
  'i2cset', 'ionice', 'iorenice', 'killall5', 'logger', 'login', 'losetup', 'makedevs',
  'microcom', 'mix', 'modinfo', 'nbd-client', 'oneit', 'partprobe', 'passwd', 'pivot_root',
  'pmap', 'poweroff', 'rfkill', 'sendevent', 'sntp', 'switch_root', 'tunctl', 'unshare',
  'vconfig',
])

/**
 * Symlinks pointing at OTHER programs (not toybox), as `[name, target]`. Never invoke these
 * blind: `reboot -> begetctl` rebooted the device during this measurement.
 */
export const NON_TOYBOX_SYMLINKS = Object.freeze([
  ['reboot', 'begetctl'],
  ['resize.f2fs', 'fsck.f2fs'],
  ['service_control', 'begetctl'],
  ['sload.f2fs', 'fsck.f2fs'],
])

/**
 * Names whose bare form runs the SHELL builtin instead of the toybox applet (measured via
 * `unalias <n>; type <n>` -> `is a shell builtin`).
 */
export const SHADOWED_BUILTINS = Object.freeze([
  'cat', 'echo', 'false', 'kill', 'pwd', 'realpath', 'sleep', 'test', 'true', 'ulimit',
])

/** Shell reserved words sharing a name with an applet (measured: `is a reserved word`). */
export const RESERVED_WORDS = Object.freeze([
  'time',
])

/**
 * Names the platform accepts and then refuses at runtime. `chmod`/`chown` return
 * `13900012 Permission denied` — **in the APP domain** (`cl.filemanagement.2`, SDK 4.1.5.2).
 * Measured nuance: in the SHELL domain (`u:r:sh:s0`) `ln -s` and `chmod` both SUCCEED, while
 * hard links are refused everywhere. Disclosed so the model never claims bits are changeable
 * from inside the sandbox (spec FR-4.7).
 */
export const PLATFORM_DENIED = Object.freeze(['chmod', 'chown'])

/**
 * The resident shell is mksh R59 — measured: `KSH_VERSION=@(#)MIRBSD KSH R59 2020/10/31`, and
 * `/system/bin/sh` is a regular file whose md5 differs from `toybox`'s. It ships 130 identity
 * aliases (`alias cat=cat`), so `command -v <n>` prints `alias <n>=<n>` rather than a path —
 * use `type` or `whence -v` when a path is wanted.
 */
export const SHELL_IS_MKSH_R59 = true

/** Count of mksh identity aliases measured on the device (for disclosure). */
export const IDENTITY_ALIAS_COUNT = 130

/** Compact comma-separated join used in prose. */
function inline(names) {
  return names.join(', ')
}

/**
 * The description template. Built once; {@link buildToolDescription} substitutes the limits.
 * JSON-encoded on purpose: the text contains backticks, quotes and newlines that must not be
 * re-escaped by hand.
 */
const DESCRIPTION = "Execute a command string in one persistent, NON-PTY, non-interactive `/system/bin/sh` and return its combined stdout+stderr with `Exit code: <rc>` on the first line. Because the shell is resident, `cd` and shell variables persist ACROSS calls; there is no TTY, so full-screen interactive programs (editors, pagers, `top`) are not supported. Completion is detected by a hidden sentinel line, not by a process-exit event. A non-zero exit code is a normal result, not a tool error. You may lower the timeout with `timeout_ms`; the tool caps it at @@TIMEOUT@@ ms. Commands longer than @@MAXCHARS@@ characters are refused before dispatch, and output is truncated to the first @@MAXBYTES@@ bytes with an explicit notice while the stream is still drained.\n\nCommand reachability on this device (MEASURED per command, toybox 0.8.12):\n- A (directly callable — 177 names, the bare form works): awk, base64, basename, cal, cat, chcon, chgrp, chmod, chown, chroot, chvt, cksum, clear, cmp, comm, count, cp, cpio, crc32, cut, ...\n- B (compiled but NOT on PATH — use `toybox <name>`): nc\n- The extended (build-flag-gated) applets ARE compiled here: awk, diff, expr, getfattr, ipcs, telnet, traceroute, traceroute6, tr, wget\n- D (does not exist): bash, busybox, vi, man, strace, bc, fdisk, fsck, git, crond, and GNU coreutils generally\n- TRAP: 42 names exist as /system/bin symlinks but their applet is NOT compiled, so they fail with `toybox: Unknown command` — acpi, arch, ascii, blockdev, bunzip2, bzcat, chattr, chrt, devmem, dnsdomainname, eject, fsfreeze, halt, hwclock, ... Always probe with `toybox <name> --help` before relying on a name; `ls` and `command -v` report these as available.\n- `reboot` -> `begetctl`, `resize.f2fs` -> `fsck.f2fs`, `service_control` -> `begetctl`, `sload.f2fs` -> `fsck.f2fs` point at OTHER programs, not toybox. Never invoke unrecognised names blindly: `reboot` really reboots the device.\n- chmod, chown exist on PATH but the platform denies their effect at runtime in the app domain (13900012 Permission denied).\n- The shell is mksh R59 (NOT toysh). These names therefore run the SHELL builtin, not the applet: cat, echo, false, kill, pwd, realpath, sleep, test, true, ulimit, and the reserved word time. Prefix with `toybox` to force the applet. Also, `command -v <name>` returns an alias string, not a path.\n\nPath fence: before dispatch, literal path tokens and redirection targets are checked against the session workspace and the deployment-configured writable roots. An out-of-root literal path, or a construct that hides a path (variable expansion, `$(...)`, backticks, `eval`, a nested shell, `xargs`, `find -exec`), is refused under the default `enforce` mode. This fence is BEST-EFFORT and BYPASSABLE — it is not a sandbox, and the shell runs with the application's own full file access. Serious commands may be rejected outright by the default deny list (system/hardware control verbs)."

/**
 * Build the model-facing tool description. Pure and total: the same inputs always produce the
 * same text. Discloses the non-PTY resident backend and persistent cwd; sentinel-driven
 * completion and the `Exit code:` result line; the reachability classes with the DANGLING trap
 * and the non-toybox symlinks called out; the shell's identity and its shadowed names; and that
 * the path fence is best-effort and bypassable (spec §6.4).
 * @param {{ commandTimeoutMs?: number, maxCommandChars?: number, maxOutputBytes?: number }} [limits] - defaults to the spec FR-5.1 values.
 * @returns {string} the tool description.
 */
export function buildToolDescription(limits = {}) {
  const commandTimeoutMs = limits.commandTimeoutMs ?? 120000
  const maxCommandChars = limits.maxCommandChars ?? 65536
  const maxOutputBytes = limits.maxOutputBytes ?? 262144
  return DESCRIPTION.replace('@@TIMEOUT@@', String(commandTimeoutMs))
    .replace('@@MAXCHARS@@', String(maxCommandChars))
    .replace('@@MAXBYTES@@', String(maxOutputBytes))
}
