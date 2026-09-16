---
name: harmony-runtime-capabilities
description: What this HarmonyOS build of DeepSeek Harness can and cannot do — available tools, how to list directories, why file creation can fail outside the workspace, and which shell/exec capabilities are absent. Read this before assuming a command or tool works.
whenToUse: Before running shell commands, listing directories, deleting or moving files, writing into Desktop/Documents/Download, or when a tool seems to be missing.
---

# HarmonyOS runtime capabilities

This deployment runs inside a HarmonyOS HAP on the Electron-on-HarmonyOS runtime. The
platform removes several capabilities that a normal `dsh` install has. Check the facts
below before you spend turns discovering them.

## Listing directories

There is **no `ls`, `glob`, or `grep`**. Use `str_replace_editor` with `command: "view"`
and a directory path — it lists non-hidden entries two levels deep.

```
str_replace_editor(command="view", path="/data/storage/el2/base/files/<workspace>")
```

`grep`/`glob` are unavailable because they shell out to a ripgrep binary. To search
content, read the files you care about and search them yourself.

## No command execution

`sh`, `bash`, `zsh`, `pwsh`, and arbitrary process launching are **all unavailable**.
There is no shell tool. Consequently `pwd`, `cat`, `git`, `curl`, and `node` cannot be
run. Do not plan work that depends on them.

- Use `read` to inspect files, not `cat`.
- Use `web_search` / `web_fetch` for network access (read-only, GET only).
- The working directory is known from context; you cannot discover it with `pwd`.

## No delete, move, rename, or copy

The filesystem seam exposes only read / write / edit / list. There is no tool that can
delete, move, rename, copy, or `chmod` a file, and no shell to fall back on. Anything you
create stays until the user removes it. Avoid generating temporary files you cannot clean
up, and prefer editing in place over write-then-rename strategies.

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
| `glob` / `grep` (content search) | absent |
| delete / move / rename / copy | absent |
| background jobs started from a shell | absent |

## Related reading

The project's own capability inventory, including the root cause and recovery plan for
each gap, lives in the repository at
`deepseek-harness-harmony/docs/鸿蒙环境能力清单-v0.1.5.md`. Read it when you need the
reasoning behind a limitation or want to know whether it is fixable.
