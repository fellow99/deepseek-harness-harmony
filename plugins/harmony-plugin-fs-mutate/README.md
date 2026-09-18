[中文](./README_zh.md) | English

---

# harmony-plugin-fs-mutate

Model-facing `delete`, `move`, `copy`, and `chmod` filesystem tools for DeepSeek Harness.

## Purpose

`ctx.fs` historically exposed no delete, rename, copy, or permission primitive, so the model could create and edit files but never remove, relocate, duplicate, or re-permission them. This plugin registers four tools over the seam's fenced mutation primitives:

| Tool | Arguments | Behavior |
|---|---|---|
| `delete` | `paths` (required), `recursive?` | Removes each path independently through `ctx.fs.remove`. One failure never stops the batch; the result lists what was deleted and the verbatim error for every path that failed. A non-empty directory needs `recursive: true`. |
| `move` | `from` (required), `to` (required), `recursive?` | Fenced copy followed by a fenced removal of the source. The copy never overwrites: an existing destination file fails the move, and the source is removed only after the copy succeeded. A directory needs `recursive: true`. |
| `copy` | `from` (required), `to` (required), `recursive?` | The same fenced copy as `move` without the removal. Like `move` it never overwrites an existing destination file, and a directory needs `recursive: true`. |
| `chmod` | `path` (required), `mode` (required) | Sets POSIX permission bits. `mode` is three or four octal digits as a string (`"644"`, `"0755"`); symbolic modes are refused. The bits are read back and verified after the change. |

`copy` and `move` transfer each file **byte-for-byte** (`readBytes` into `writeBytes`), so binary content is carried unchanged. They share one planner, so their containment, overwrite, and empty-directory rules cannot drift apart.

Every mutation goes through `ctx.fs`, so the mounted backend owns target identity, atomicity, and the sandbox fence. The plugin never opens a path with `node:fs`, and it never calls `rename` — `hmdfs` (the HarmonyOS filesystem behind the shipped product) documents its rename as same-directory only, so copy-then-remove is the portable implementation.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxTransferBytes` | `10485760` (10 MiB) | Inclusive per-file byte cap for the `copy` and `move` copies. `ctx.fs.readBytes` requires a cap so a backend never buffers an unbounded file; a larger source fails with `FS_TOO_LARGE` before the copy starts. |

```yaml
- name: harmony-plugin-fs-mutate
  config:
    maxTransferBytes: 10485760
```

## Sandbox escalation

Under a confining `ctx.fs` (a backend whose `sandboxMode` is defined) all four tools advertise `sandbox_permissions` and `justification`; under a bare backend the fields are absent from the schema, so the validator rejects them. A denied mutation returns the shared `[sandbox: file access denied under <mode> mode]` marker plus the escalation hint, and a retry with the narrowest sufficient wider mode raises one approval prompt. The granted mode is stamped per call and covers every mutation of that call — both halves of a `move`, and every write of a `copy`.

## What the model sees

**Tool results.** `delete` renders `Deleted N paths:` with `- <path> (<kind>)` lines, then a blank line and `Failed to delete M paths:` with `- <path>: <verbatim error>` lines when any path failed. `move` renders `Moved "<from>" to "<to>".` for a file and `Moved directory "<from>" to "<to>" (N files).` for a directory; `copy` renders the same sentences with `Copied`. `chmod` renders `Set mode <mode> on "<path>".`, where `<mode>` is the mode read back, in four-digit octal.

**Errors.** Failures are the seam's typed `FsError` messages, unchanged: `cannot move "<path>": not found`, `cannot copy "<a>" to "<b>": the destination is the source itself or inside it`, `cannot chmod "<path>": the filesystem kept mode 660 instead of 755`, and the sandbox markers above. A malformed `mode` is rejected before any I/O. `delete` reports per-path failures in its result rather than throwing, so the model always receives the full batch outcome.

## Known Limitations

- **The byte primitives depend on a patched seam.** Upstream `ctx.fs` exposes no byte-writing mutation — `writeText` rejects binary content — so `copy` and `move` publish each file through the `writeBytes` primitive added by [`dsh-fs-write-bytes.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-write-bytes.patch). In a composition without that patch the seam refuses the write instead of truncating the copy.
- **`chmod` depends on a patched seam too.** Upstream `ctx.fs` exposes no permission primitive, so the tool needs the `chmod` member added by [`dsh-fs-chmod-primitive.patch`](../../patches/dsh-v0.1.5-rc.2/dsh-fs-chmod-primitive.patch); without it the base member throws `FS_IO_ERROR` and the tool reports that rather than pretending to have changed anything.
- **`chmod` fails where the filesystem ignores permission bits.** The change is read back and the applied mode compared, so a storage layer that accepts the call without applying the **requested** mode is reported as an error instead of a silent success. This is the observed behavior of the HarmonyOS shared user mounts (`hmdfs`), which store a mode of their own choosing (a request for `640` came back as `660`) and return no error; inside the app sandbox (`hmfs`) the bits apply as requested. A conforming POSIX filesystem is unaffected.
- **A copied file does not inherit the source's mode.** The copy publishes through the atomic-write path, which requests mode `0600` for the new destination and never copies the source's bits. On a filesystem that ignores permission bits the effective mode is whatever that filesystem assigns. Call `chmod` afterwards when the mode matters.
- **A copy never overwrites.** An existing destination file fails the operation; there is no force flag.
- **An empty directory cannot be copied or moved.** `ctx.fs` exposes no directory-creation primitive, so a destination directory exists only as a side effect of writing a file into it. A tree that would contain an empty directory is refused before anything is copied, instead of dropping the empty directory silently.
- **A failed copy leaves a partial destination.** For `move` the source survives (it is removed only after a successful copy), but files already written to the destination stay there; delete the destination manually before retrying.
- **A symlink is followed and materialized.** `listDir` reports the link's target type, so a copy reproduces the link target's contents as regular entries rather than recreating the link.
- **Destination paths assume the host separator.** The destination tree is built with `ctx.fs.resolve(name, { cwd })` against already-resolved display paths, which is platform-correct for the shipped local and sandboxed backends; a remote backend whose display paths use a different dialect would need a path-join by that backend.
- **No `fs/observed` emission.** A path deleted or moved by these tools is not recorded as absent, so a later guarded `write` to it needs one `read` first. This is the fail-closed direction of the `dsh-fs-observation-policy` contract and is deliberate.

## Dependencies

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-tools`, and `@deepseek-ai/schemastery` are declared as `peerDependencies` and supplied by the consuming build at runtime; they ship inside `dsh-dist/node_modules`, so the plugin is not published and carries no bundled or installed dependency of its own. Plain ESM, no build step — `lib/` is the shipped source.

## Tests

`npm test` runs `tests/permissions.test.mjs` (the `mode` grammar) and `tests/transfer.test.mjs` (the shared planner). Both run on plain Node with no framework: the two engine modules — `lib/permissions.js` and `lib/transfer.js` — are deliberately import-free, so they are driven against an in-memory `ctx.fs` stub without touching a disk or importing any dsh package. The tool registrations in `lib/delete.js`, `lib/move.js`, `lib/copy.js`, and `lib/chmod.js` are covered on device through `specs/202-plugin-fs-mutate/`.
