---
name: harmony-runtime-capabilities
description: What this HarmonyOS build of DSH can and cannot do — available tools, how to list directories, how command execution works (a non-PTY resident `bash` tool), why file creation can fail outside the workspace, and which capabilities are absent. Read this before assuming a command or tool works.
whenToUse: Before running shell commands with `bash`, listing directories, deleting, moving or copying files, changing file permissions, writing into Desktop/Documents/Download, or when a tool seems to be missing.
---

# HarmonyOS runtime capabilities

This deployment runs inside a HarmonyOS HAP on the Electron-on-HarmonyOS runtime. The
platform removes several capabilities that a normal `dsh` install has. Check the facts
below before you spend turns discovering them.

## Listing and finding files

Prefer the filesystem tools for listing and searching; the `bash` tool below can also run
`ls`, but it is a command runner, not a replacement for the fenced file tools.

- `str_replace_editor` with `command: "view"` and a directory path — it lists non-hidden entries two levels deep.

```
str_replace_editor(command="view", path="/data/storage/el2/base/files/<workspace>")
```

- `glob` — discover files by path pattern (`pattern` required, plus `path?` and `max_results?`).
  It walks `ctx.fs` in pure JavaScript and returns **files only**, never directories. `*` and
  `?` match within one path segment, `**` matches across segments, and a pattern with no `/`
  matches the file name at any depth (`*.ts` searches the whole tree). Every dot-directory and
  the configured `node_modules`/`.git` names are skipped; hidden *files* are returned.
- `grep` — search file contents (`pattern` is a JavaScript regular expression source, plus
  `path?`, `include?`, and `max_results?`). It returns `<path>:<line>: <text>` rows and skips
  binary or unreadable files.

Both are provided by a pure-JavaScript plugin; they do **not** spawn the ripgrep binary, which
this sandbox cannot execute. They are search tools, not a shell.

## Command execution (`bash`)

Command execution **is** available through the `bash` tool — a project-specific plugin that
runs commands in **one long-lived, non-PTY `sh`** driven by a hidden marker line. It is
**not** the upstream PTY terminal (that stays disabled: `node-pty` has no aarch64 artifact),
and it appears only in presets that already carry the upstream `tool-bash` row.

What this means in practice:

- Directly runnable are the **A-class** commands (`pwd`, `ls`, `cat`, `grep` (the binary) and the
  other bare-name coreutils-style tools) and any applet reached as `toybox <name>` (for example
  `nc`). `git` and `curl` are **未验证 / not available** — `git` is not shipped at all, and
  `curl` is not a toybox applet in the OpenHarmony standard set. Some applets are gated by a
  build flag and are **未验证** (`awk`, `wget`, `diff`, `expr`), and GNU-only tools (`bash`,
  `busybox`, `vi`, `strace`) do **not** exist. Confirm a doubtful applet with `toybox --long`.
- The shell behind `bash` is **`/system/bin/sh`, which is mksh R59 — not toysh** (device-verified
  2026-09-22). Exactly these names are intercepted by the shell and therefore do **not** run the
  toybox applet: **builtins** `cat echo false kill pwd realpath sleep test true ulimit`, plus the
  **reserved word** `time`. Write `toybox <name>` to force the toybox implementation. Notably
  `printf`, `ls`, `grep`, `sed` are **not** intercepted — those still run toybox.
  Do **not** infer the shell from `readlink /proc/self/exe` (it misreports `/system/bin/toybox`) or
  from `uname -a` (its trailing `Toybox` is a kernel string).
- **Some `/system/bin` names are broken or belong to other programs.** 42 names are **dangling
  symlinks** to `toybox` whose applet is not compiled (they fail with `toybox: Unknown command`) —
  e.g. `acpi arch ascii bunzip2 bzcat chattr chrt devmem halt hwclock i2c* …` and `poweroff`.
  Judge availability with `toybox <name> --help`, never with `ls`/`command -v`. Four symlinks point
  at **other** programs (`reboot`/`service_control` → `begetctl`, `resize.f2fs`/`sload.f2fs` →
  `fsck.f2fs`) — `reboot` really reboots the device, so never invoke unrecognised names.
- **`command -v <name>` does not return a path here.** mksh ships 130 identity aliases
  (`alias cat=cat`), so `command -v cat` prints `alias cat=cat`. Use `type`, `whence -v`, or the
  `toybox <name>` form instead.
- The extended applet set IS compiled on this device (`toybox_extended_cmd` is enabled): `awk`,
  `wget`, `diff`, `expr`, `tr`, `telnet`, `traceroute`, `traceroute6`, `getfattr`, `ipcs` are all
  directly usable. Full per-command evidence: `docs/toybox命令清单.md`.
- State persists: `cd` and shell variables carry over between `bash` calls. There is no per-call
  `workdir` parameter.
- There is **no TTY**, so interactive programs (editors, pagers, `top`) are unsupported and
  **未验证**; use non-interactive forms.
- A non-zero exit code is a normal result (`Exit code: N`), not a tool error.
- **The path fence is best-effort and bypassable.** Out-of-root literal paths and path-hiding
  constructs (`$VAR`, `$(...)`, backticks, `eval`, a nested `sh -c`, `xargs`, `find -exec`) are
  refused, but the shell runs with the application's own full file access and is **not** a
  sandbox. Prefer the fenced `read`/`write`/`edit`/`delete`/`move`/`copy` tools for file work;
  reach for `bash` only when no tool fits.
- Background jobs started from a shell remain **absent** (`job_list`/`job_output` still have no
  starter).
- `pwsh` remains **absent** (Windows-only).

- Use `read` to inspect files rather than `cat` when you only need the contents.
- Use `web_search` / `web_fetch` for managed network access; `bash` has no special network grant.

## Deleting, moving, copying, and permissions

Four file-mutation tools **are** available in this build:

- `delete` — `paths` (required), `recursive?`. Removes each path independently; one failure
  never stops the batch, and the result lists what was deleted plus the verbatim error for
  every path that failed. A non-empty directory needs `recursive: true`.
- `move` — `from` (required), `to` (required), `recursive?`. Copy-then-remove: the copy never
  overwrites (an existing destination fails the move), and the source is removed only after the
  copy succeeded. A directory needs `recursive: true`.
- `copy` — `from` (required), `to` (required), `recursive?`. The same fenced copy as `move`
  without the removal; like `move` it never overwrites an existing destination file.
- `chmod` — `path` (required), `mode` (required). `mode` is three or four **octal** digits as a
  string, for example `"644"` or `"0755"`; symbolic modes such as `"u+rw"` are refused.

All four go through the same sandbox fence as `write`/`edit`, so a path outside the workspace is
denied on the first attempt and needs the escalation described below. Use them freely for
temporary files instead of leaving clutter behind.

`copy` and `move` transfer each file **byte-for-byte** (raw read into raw write), so binary
content survives unchanged — do not treat them as text-only.

Known limitations (all verified on device):

- **An empty directory cannot be copied or moved.** The seam exposes no directory-creation
  primitive, so a tree that would contain an empty directory is refused up front rather than
  silently dropping it.
- **A copy never overwrites.** An existing destination file fails the operation; delete or move
  it out of the way first if you need to replace it.
- **A failed copy leaves a partial destination.** For `move` the source survives (it is removed
  only after a successful copy), but files already written to the destination stay there —
  remove the destination before retrying.
- **A copied file gets the backend's default mode, not the source's.** The copy publishes through
  the atomic-write path, which creates the destination with mode `0600`; the source's permission
  bits are not carried over. Use `chmod` afterwards when the mode matters.
- **`chmod` only takes effect inside the workspace.** The new mode is read back and verified. On the
  shared user directories under `/storage/Users/currentUser` (the `hmdfs` volume) the filesystem
  accepts the call but does **not** apply the mode you asked for — it stores a mode of its own
  choosing (measured: a request for `640` came back as `660`) and returns no error. This build
  reports that mismatch as a failure instead of a silent success, so an error there means "this
  filesystem does not honor the requested permission bits", not "you wrote the call wrong". Inside
  the workspace (the `hmfs` volume) the bits take effect.
- **`rename` is still absent as a tool.** The seam exposes no rename primitive, and `hmdfs`
  documents its rename as same-directory only, so `move` is
  copy-then-remove: the destination is a new file with new metadata (a fresh modification time,
  and the mode described above). Do not rely on write-then-rename strategies.

## Creating files

`read` → `write` always works inside the workspace. Creating a **new** file can fail
outside it: the atomic publish path uses a hard link, which the HarmonyOS user-directory
filesystem (`hmdfs`) refuses. Symptoms are an `EPERM ... link` error from `write`.

Workaround when a new file must land outside the workspace:

1. Create it inside the workspace first, or
2. Get the target to exist (any existing file can be overwritten — overwrite goes through
   `rename`, which `hmdfs` supports), then `edit`/`write` it.

`hmdfs` is also **case-insensitive** outside the workspace: `README.md` and `readme.md`
collide there. The workspace itself is on a local case-sensitive filesystem, so normal
conventions hold.

## Writing outside the workspace

Paths outside the session workspace are fenced by the file sandbox: the first write is
denied with `file access denied under workspace-write mode`. That denial carries an
escalation hint — retry once with `sandbox_permissions` set to the narrowest wider mode
plus a `justification`. The user is asked to approve.

The user's `Desktop`, `Documents`, and `Download` directories are a separate matter: they
are governed by HarmonyOS system permissions, and a write may fail even after escalation.
Prefer keeping artifacts inside the workspace and telling the user where they are.

## Available capabilities

| Capability | Status |
|---|---|
| `read` / `write` / `edit` on files | available (workspace) |
| `str_replace_editor` (`view` lists directories) | available |
| `web_search` / `web_fetch` | available |
| `skill`, `todo_write`, goals, subagents, workflows, `present` | available |
| `bash` command execution | **available** (non-PTY resident `sh`; the path fence is best-effort, not a sandbox) |
| `pwsh` (PowerShell) | absent (Windows-only) |
| PTY terminal / persistent shell | absent (no aarch64 `node-pty` artifact) |
| `glob` (file discovery) / `grep` (content search) | **available** (pure JavaScript, no ripgrep binary) |
| `delete` / `move` / `copy` (file mutation) | **available** |
| `chmod` (permission bits) | **available** in the workspace; the user-directory volume ignores it and the tool reports that as an error |
| `rename` | absent (use `move`, which is copy-then-remove) |
| background jobs started from a shell | absent |

## Related reading

The project's own capability inventory, including the root cause and recovery plan for
each gap, lives in the repository at
`dsh-desktop-hos/docs/鸿蒙环境能力清单-v0.1.5.md`. Read it when you need the
reasoning behind a limitation or want to know whether it is fixable.
