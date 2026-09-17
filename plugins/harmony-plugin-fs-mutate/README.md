[中文](./README_zh.md) | English

---

# harmony-plugin-fs-mutate

Model-facing `delete` and `move` filesystem tools for DeepSeek Harness.

## Purpose

`ctx.fs` historically exposed no delete or rename, so the model could create and edit files but never remove or relocate them. This plugin registers two tools over the seam's fenced removal primitive:

| Tool | Arguments | Behavior |
|---|---|---|
| `delete` | `paths` (required), `recursive?` | Removes each path independently through `ctx.fs.remove`. One failure never stops the batch; the result lists what was deleted and the verbatim error for every path that failed. A non-empty directory needs `recursive: true`. |
| `move` | `from` (required), `to` (required), `recursive?` | Fenced copy followed by a fenced removal of the source. The copy never overwrites: an existing destination file fails the move, and the source is removed only after the copy succeeded. A directory needs `recursive: true`. |

Every mutation goes through `ctx.fs`, so the mounted backend owns target identity, atomicity, and the sandbox fence. The plugin never opens a path with `node:fs`, and it never calls `rename` — `hmdfs` (the HarmonyOS filesystem behind the shipped product) documents its rename as same-directory only, so copy-then-remove is the portable implementation.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxTransferBytes` | `10485760` (10 MiB) | Inclusive per-file byte cap for the `move` copy. `ctx.fs.readBytes` requires a cap so a backend never buffers an unbounded file; a larger source fails with `FS_TOO_LARGE` before the copy starts. |

```yaml
- name: harmony-plugin-fs-mutate
  config:
    maxTransferBytes: 10485760
```

## Sandbox escalation

Under a confining `ctx.fs` (a backend whose `sandboxMode` is defined) both tools advertise `sandbox_permissions` and `justification`; under a bare backend the fields are absent from the schema, so the validator rejects them. A denied mutation returns the shared `[sandbox: file access denied under <mode> mode]` marker plus the escalation hint, and a retry with the narrowest sufficient wider mode raises one approval prompt. The granted mode is stamping per call and covers both mutations of a `move`.

## What the model sees

**Tool results.** `delete` renders `Deleted N paths:` with `- <path> (<kind>)` lines, then a blank line and `Failed to delete M paths:` with `- <path>: <verbatim error>` lines when any path failed. `move` renders `Moved "<from>" to "<to>".` for a file and `Moved directory "<from>" to "<to>" (N files).` for a directory.

**Errors.** Failures are the seam's typed `FsError` messages, unchanged: `cannot move "<path>": not found`, `cannot move "<path>": invalid UTF-8 text, and this filesystem seam can copy only text files`, `cannot move "<a>" to "<b>": the destination is the source itself or inside it`, and the sandbox markers above. `delete` reports per-path failures in its result rather than throwing, so the model always receives the full batch outcome.

## Known Limitations

- **A move copies text only.** `ctx.fs.writeText` rejects binary content, so a `move` decodes with a strict UTF-8 decoder and fails a binary source with `FS_NOT_TEXT`. Binary relocation is out of scope for this seam.
- **An empty directory cannot be moved.** `ctx.fs` exposes no directory-creation primitive, so a destination directory exists only as a side effect of writing a file into it. A tree that would contain an empty directory is refused before anything is copied, instead of dropping the empty directory silently.
- **A failed copy leaves a partial destination.** The source survives (it is removed only after a successful copy), but files already written to the destination stay there; delete the destination manually before retrying.
- **A symlink is followed and materialized.** `listDir` reports the link's target type, so a move copies the link target's contents as regular entries rather than recreating the link.
- **Destination paths assume the host separator.** The destination tree is built with `ctx.fs.resolve(name, { cwd })` against already-resolved display paths, which is platform-correct for the shipped local and sandboxed backends; a remote backend whose display paths use a different dialect would need a path-join by that backend.
- **No `fs/observed` emission.** A path deleted or moved by these tools is not recorded as absent, so a later guarded `write` to it needs one `read` first. This is the fail-closed direction of the `dsh-fs-observation-policy` contract and is deliberate.

## Dependencies

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-tools`, and `@deepseek-ai/schemastery` are declared as `peerDependencies` and supplied by the consuming build at runtime; they ship inside `dsh-dist/node_modules`, so the plugin is not published and carries no bundled or installed dependency of its own. Plain ESM, no build step — `lib/` is the shipped source.
