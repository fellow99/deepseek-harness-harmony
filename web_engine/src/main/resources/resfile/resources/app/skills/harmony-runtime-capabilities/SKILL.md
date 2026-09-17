---
name: harmony-runtime-capabilities
description: What this HarmonyOS build of DeepSeek Harness can and cannot do — available tools, how to list directories, why file creation can fail outside the workspace, and which shell/exec capabilities are absent. Read this before assuming a command or tool works.
whenToUse: Before running shell commands, listing directories, deleting or moving files, writing into Desktop/Documents/Download, or when a tool seems to be missing.
---

# HarmonyOS runtime capabilities

This deployment runs inside a HarmonyOS HAP on the Electron-on-HarmonyOS runtime. The
platform removes several capabilities that a normal `dsh` install has. Check the facts
below before you spend turns discovering them.

## Listing and finding files

There is **no `ls`** and no shell. Use:

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

## No command execution

`sh`, `bash`, `zsh`, `pwsh`, and arbitrary process launching are **all unavailable**.
There is no shell tool. Consequently `pwd`, `cat`, `git`, `curl`, and `node` cannot be
run. Do not plan work that depends on them.

- Use `read` to inspect files, not `cat`.
- Use `web_search` / `web_fetch` for network access (read-only, GET only).
- The working directory is known from context; you cannot discover it with `pwd`.

## Deleting and moving files

Two file-mutation tools **are** available in this build:

- `delete` — `paths` (required), `recursive?`. Removes each path independently; one failure
  never stops the batch, and the result lists what was deleted plus the verbatim error for
  every path that failed. A non-empty directory needs `recursive: true`.
- `move` — `from` (required), `to` (required), `recursive?`. Copy-then-remove: the copy never
  overwrites (an existing destination fails the move), and the source is removed only after the
  copy succeeded. A directory needs `recursive: true`.

Both go through the same sandbox fence as `write`/`edit`, so a path outside the workspace is
denied on the first attempt and needs the escalation described below. Use them freely for
temporary files instead of leaving clutter behind.

Known limitations of `move` (all verified on device):

- **Text files only.** The seam's `writeText` rejects binary content, so moving a binary source
  fails with `FS_NOT_TEXT`. There is no binary-relocation path.
- **An empty directory cannot be moved.** The seam exposes no directory-creation primitive, so a
  tree that would contain an empty directory is refused up front rather than silently dropping it.
- **A failed copy leaves a partial destination.** The source survives (it is removed only after a
  successful copy), but files already written to the destination stay there — remove the
  destination before retrying.

`rename`, a standalone `copy`, and `chmod` remain **absent**: there is no tool for them and no
shell to fall back on. Do not rely on write-then-rename strategies — use `move` to relocate a file.

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
| shell / `bash` / `pwsh` | absent |
| `glob` (file discovery) / `grep` (content search) | **available** (pure JavaScript, no ripgrep binary) |
| `delete` / `move` (file mutation) | **available** |
| rename / standalone `copy` / `chmod` | absent |
| background jobs started from a shell | absent |

## Related reading

The project's own capability inventory, including the root cause and recovery plan for
each gap, lives in the repository at
`deepseek-harness-harmony/docs/鸿蒙环境能力清单-v0.1.5.md`. Read it when you need the
reasoning behind a limitation or want to know whether it is fixable.
