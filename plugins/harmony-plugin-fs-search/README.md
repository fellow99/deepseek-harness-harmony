# harmony-plugin-fs-search

Model-facing `grep` content-search tool for DeepSeek Harness.

## Purpose

`@deepseek-ai/dsh-tool-fs-search` provides `grep`/`glob` by executing the packaged `@vscode/ripgrep` native binary through `ctx.subprocess`. The harmony build cannot do that (no runnable native binary in the HAP sandbox) and disables the preset row, while `str_replace_editor`'s `view` command already covers directory listing — so what remained missing was **content search**. This plugin restores exactly that, with one tool:

| Tool | Arguments | Behavior |
|---|---|---|
| `grep` | `pattern` (required), `path?`, `include?`, `max_results?` | Recursively walks `path` (default: the session workspace) and returns one row per matching line as `<displayPath>:<lineNumber>: <line text>`, followed by a summary sentence. |

The search is plain JavaScript running in the host process: no native binary, no subprocess, no glob package, and no `node:fs`. Every read goes through `ctx.fs` (`stat`, `listDir`, `readText`), so the mounted backend keeps owning path identity, decoding, and binary rejection, exactly as it does for `read`/`write`/`edit`. Because the tool only reads, it advertises no sandbox-escalation fields — reads are never fenced, only mutations are.

## Configuration

Every key is optional; the defaults are `lib/search.js`'s `DEFAULT_LIMITS`. All numeric caps are validated in `apply` as positive safe integers — a zero, a negative, a fraction, or a value past `Number.MAX_SAFE_INTEGER` fails the composition instead of silently disabling a bound. Unbounded walking is not an option on a device: the walk reads real files.

| Key | Default | Meaning |
|---|---|---|
| `maxResults` | `200` | Total matches retained from one call. The walk stops as soon as the next match would exceed it, and the summary says the result was truncated. |
| `maxMatchesPerFile` | `50` | Matches retained from any single file; further matches in that file are dropped and the summary counts the file. |
| `maxFiles` | `2000` | Files read in one call. The walk stops as soon as the next file would exceed it, and the summary says so. |
| `maxFileBytes` | `524288` (512 KiB) | Inclusive byte cap per file. A file whose reported size is larger is skipped **before it is read**, and counted as skipped. |
| `maxDepth` | `8` | Directory levels descended below the search root. The root itself is level 0, so `1` searches the root and its immediate subdirectories. |
| `maxLineChars` | `300` | Characters kept per matched line before it is cut and marked. |
| `skippedDirectories` | `["node_modules", ".git"]` | Directory names never descended into, at any depth. A name beginning with `.` is **always** skipped too, so removing `.git` from this list does not make it searchable; listing it here documents the intent. Hidden *files* are searched. |

```yaml
- name: harmony-plugin-fs-search
  config:
    maxResults: 200
    maxFileBytes: 524288
    skippedDirectories:
      - node_modules
      - .git
```

## What the model sees

**Tool results.** The value is a single string, rendered as one text block: one `<displayPath>:<lineNumber>: <line text>` row per match, a blank line, then the summary sentence.

```
src/parser.ts:12: const token = lexer.needle()
src/parser.ts:88: // needle: the anchor token
docs/notes.md:4: replace the needle before shipping

Found 3 matches in 3 files (files searched: 41, files skipped as unreadable or too large: 2).
```

The summary always names the match count, the number of matched files, and the files searched. It appends only the facts that apply: `files skipped as unreadable or too large`, `directories skipped as unreadable`, `directories not entered past maxDepth N`, and `files past the N-matches-per-file cap`. A search with no matches is the summary alone — `Found 0 matches in 0 files (files searched: 41).`

When a global cap stops the search early, a second sentence says so instead of dropping results silently:

```
Found 200 matches in 12 files (files searched: 355).
Results were truncated because the maxResults cap of 200 was reached; narrow pattern, path, or include and retry.
```

**Parameters.** `pattern` is a JavaScript regular expression source tested against one line at a time, with no flags — matching is case-sensitive and there is no case-insensitive switch. `path` defaults to the session workspace. `include` is one filename glob filter supporting `*` and `?` (a filter with no `/` matches the file name at any depth, the ripgrep convention). `max_results` only lowers the tool's own `maxResults` cap for one call; a larger value is clamped to it.

**Errors.** Argument problems are plain errors: `pattern must be a non-empty string`, `path must be a non-empty string when given`, `max_results must be a positive integer when given`, `pattern is not a valid JavaScript regular expression: <detail>`, and the `include` rejections below. An unusable search root is a typed `FsError`: `cannot search "<path>": not found` (`FS_NOT_FOUND`) or `cannot search "<path>": not a regular file or directory` (`FS_NOT_REGULAR_FILE`). A failure listing the root propagates the backend's own error unchanged; `grep was aborted (tool timeout or caller cancellation)` reports an abandoned call. An unreadable *file* is never an error — it is skipped and counted.

## Known Limitations

- **No ripgrep syntax and no flags.** `pattern` is a plain JavaScript `RegExp` source compiled without flags, so there is no case-insensitive mode, no whole-word switch, and multiline mode is unavailable. Matching is per line, so a pattern that can only match across a newline finds nothing.
- **`include` is a minimal glob.** Only `*` and `?` are wildcards; `{a,b}` alternation, negation (`!…`), and comma-separated lists are rejected with an error instead of searching for something the model did not ask for.
- **A skipped file may still contain matches.** Binary content, a permission error, a vanished entry, and a file over `maxFileBytes` are all skipped and counted rather than read. When the summary reports skipped files, a specific `read` is the way to inspect one.
- **No spill handoff and no pagination.** The ripgrep-based upstream saved the complete match list through `ctx.spillStore`; this replacement does not, so a capped result can only be recovered by narrowing `pattern`, `path`, or `include`. There is no offset parameter.
- **A whole file is buffered per read.** `readText` decodes one file at a time after a `stat`, so `maxFileBytes` is the only per-file byte bound — and a backend that cannot report `size` leaves the cap unenforceable for that file. The walk's total bound is `maxFiles`.
- **The walk is breadth-first.** Results follow the backend's stable name order, level by level, so a capped result samples the shallow end of the tree rather than completing one deep subtree.
- **An explicit root wins over the skip list and `include`.** A `path` that names `.git` or `node_modules` is walked, and a `path` that names a file is searched regardless of `include` — while the `maxFileBytes` size check still applies to it. A symlinked directory is followed, because `listDir` reports the link target's type.
- **No timeout budget is declared.** The tool registers without `timeoutMs`, so cancellation rides `exec.signal` only (the same stance as `read`/`write`/`edit`).
- **`grep` only.** This plugin does not provide file discovery by pattern (upstream's `glob`); directory listing stays with `str_replace_editor`'s `view`.

## Dependencies

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-tools`, and `@deepseek-ai/schemastery` are declared as `peerDependencies` and supplied by the consuming build at runtime; they ship inside `dsh-dist/node_modules`, so the plugin is not published and carries no bundled or installed dependency of its own. `dsh-sandbox` is used only for `canonicalPath`, the symlinked-cwd normalization every model-facing filesystem tool in this family shares. Plain ESM, no build step — `lib/` is the shipped source.

`lib/search.js` — the search engine — imports nothing at all, which is what makes it testable on bare Node: `node tests/search.test.mjs` drives it against an in-memory `ctx.fs` stub (no test framework, no dependency) and exits non-zero on any failure.
