/**
 * Pure, dependency-free path-discovery engine behind the `glob` tool: a
 * breadth-first recursive walk over a `ctx.fs`-shaped seam that reports one
 * matching FILE path per line.
 *
 * The module imports nothing — no `@deepseek-ai/*`, no `node:fs`, no glob
 * package — so it runs against any object exposing `listDir` and `stat`
 * (which is what makes it unit-testable against an in-memory filesystem).
 * Every cap arrives from the caller; {@link DEFAULT_GLOB_LIMITS} is this
 * engine's own default set.
 *
 * Deliberate semantics:
 * - results are FILES only: a directory is traversed but never returned, even
 *   when its own name matches the pattern, matching upstream dsh `glob`;
 * - matching is against the path relative to the search root with `/`
 *   separators, except that a pattern containing no `/` matches the entry name
 *   at any depth (the ripgrep `--glob` convention, so `*.ts` searches the whole
 *   tree);
 * - the walk is breadth-first in the backend's stable name order;
 * - a directory whose name is excluded, or which would exceed `maxDepth`, is
 *   never listed at all, and the explicitly named search root is always walked
 *   even when its own name is excluded;
 * - hidden FILES are returned; every dot-directory is skipped.
 * @module harmony-plugin-fs-search/glob
 */

/**
 * The glob engine's default caps and skip list. The plugin `Config` in
 * `lib/index.js` supplies these same bound names, so the mounted tool takes
 * its caps from the resolved plugin config; this constant exists for callers
 * and tests that drive the engine directly.
 */
export const DEFAULT_GLOB_LIMITS = {
  /** Matching files retained from one call; the walk stops when the next match would exceed it. */
  maxResults: 200,
  /** File entries visited in one call; the walk stops when the next file would exceed it. */
  maxFiles: 2000,
  /**
   * Directory levels descended below the search root. The root itself is level
   * 0, so `1` searches the root and its immediate subdirectories, and `0` is
   * rejected by the plugin (a positive cap is required).
   */
  maxDepth: 8,
  /**
   * Directory names never descended into, at any depth. A name beginning with
   * `.` is always skipped as well, so removing `.git` from this list does not
   * make it searchable; listing it here documents the intent.
   */
  skippedDirectories: ['node_modules', '.git'],
}

/** Regex metacharacters escaped when a glob character is meant literally. */
const REGEXP_METACHARACTERS = new Set(['\\', '^', '$', '.', '|', '+', '(', ')', '[', ']', '{', '}'])

/**
 * Translate one model-facing `pattern` into an anchored, separator-aware
 * matcher.
 *
 * Only `*`, `?`, and `**` are wildcards. `*` and `?` never cross a directory
 * separator; a double star followed by a separator matches zero or more
 * directories, so `**` then `*.ts` matches a `.ts` file at any depth, the root
 * included. Every other character is literal, and backslashes are normalized to
 * `/`, so a Windows-style pattern (`src\*.ts`) behaves like `src/*.ts`.
 *
 * The returned `onBasename` flag is true when the pattern carries no separator:
 * such a pattern is matched against the entry name at any depth instead of the
 * root-relative path.
 *
 * @param pattern - the model-facing `pattern` argument.
 * @returns the compiled matcher.
 * @throws {Error} for a blank pattern, a negated pattern, a comma-separated
 *   list, or brace alternation (which this implementation deliberately does not
 *   support, so the failure is loud instead of a silent zero-match walk).
 */
export function compileGlob(pattern) {
  if (pattern.trim().length === 0) throw new Error('pattern must be a non-empty string')
  if (pattern.startsWith('!')) {
    throw new Error('pattern must be a positive glob; negated patterns ("!…") are not supported')
  }
  const normalized = pattern.replaceAll('\\', '/')
  if (normalized.includes('{') || normalized.includes('}')) {
    throw new Error('pattern supports only "*", "?", and "**" wildcards; brace alternation (e.g. "*.{ts,tsx}") is not supported')
  }
  if (normalized.includes(',')) {
    throw new Error('pattern must be one glob, not a comma-separated list')
  }
  let source = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index += 1
        if (normalized[index + 1] === '/') {
          index += 1
          source += '(?:.*/)?'
        } else {
          source += '.*'
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (character === '?') {
      source += '[^/]'
      continue
    }
    source += REGEXP_METACHARACTERS.has(character) ? `\\${character}` : character
  }
  return { regex: new RegExp(`^(?:${source})$`), onBasename: !normalized.includes('/') }
}

/**
 * Whether the compiled pattern admits one file entry. A basename-only pattern
 * matches the entry name at any depth; a pattern with a separator matches the
 * path relative to the search root, always with `/` separators.
 * @param matcher - the compiled pattern.
 * @param segments - the directory segments between the root and the file's directory.
 * @param name - the file's entry name.
 * @returns true when the file's path matches.
 */
function globMatches(matcher, segments, name) {
  if (matcher.onBasename) return matcher.regex.test(name)
  const relativePath = segments.length === 0 ? name : `${segments.join('/')}/${name}`
  return matcher.regex.test(relativePath)
}

/**
 * Whether one directory name is excluded from the walk: every dot-directory,
 * plus every name in the configured skip list.
 * @param name - the directory's entry name.
 * @param skippedDirectories - the configured skip list.
 * @returns true when the directory must not be listed.
 */
function isSkippedDirectory(name, skippedDirectories) {
  return name.startsWith('.') || skippedDirectories.includes(name)
}

/**
 * The last path segment of a display path, in either separator dialect.
 * @param displayPath - the backend's display path.
 * @returns the entry name.
 */
function basenameOf(displayPath) {
  const normalized = displayPath.replaceAll('\\', '/')
  const cut = normalized.lastIndexOf('/')
  return cut === -1 ? normalized : normalized.slice(cut + 1)
}

/**
 * Stop the walk on cancellation. The walk is a read loop with no deadline of
 * its own, so `exec.signal` is the only bound on a call the caller abandoned.
 * @param signal - the per-call abort signal, when the caller supplied one.
 * @throws {Error} when the signal is already aborted.
 */
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw new Error('glob was aborted (tool timeout or caller cancellation)')
}

/**
 * Test one file entry and append it to the shared walk state when it matches.
 *
 * The `maxFiles` cap counts file entries VISITED, matching or not; the
 * `maxResults` cap counts matching files retained. Reaching either stops the
 * walk and records the reason, so a capped result is never reported as complete.
 *
 * @param file - the resolved file target.
 * @param segments - the directory segments between the root and the file's directory.
 * @param name - the file's entry name.
 * @param state - the mutable walk state (see {@link runGlob}).
 */
function collectFile(file, segments, name, state) {
  if (state.filesSearched >= state.limits.maxFiles) {
    state.truncatedFiles = true
    state.stopped = true
    return
  }
  state.filesSearched += 1
  if (!globMatches(state.matcher, segments, name)) return
  if (state.files.length >= state.limits.maxResults) {
    state.truncatedResults = true
    state.stopped = true
    return
  }
  state.files.push(file.displayPath)
}

/**
 * Walk a directory tree breadth-first and append matching file paths to the
 * shared state. Directories are traversed but never returned.
 *
 * A subdirectory that cannot be listed (permission, I/O) is counted and
 * skipped; the search root's own listing failure propagates unchanged, because
 * the caller named that path and must learn it is unusable.
 *
 * @param fs - the `ctx.fs`-shaped seam.
 * @param root - the resolved root directory target.
 * @param state - the mutable walk state (see {@link runGlob}).
 */
async function walkDirectories(fs, root, state) {
  const queue = [{ target: root, depth: 0, segments: [] }]
  for (let frameIndex = 0; frameIndex < queue.length; frameIndex += 1) {
    if (state.stopped) return
    throwIfAborted(state.signal)
    const frame = queue[frameIndex]
    let entries
    try {
      entries = await fs.listDir(frame.target, state.signal)
    } catch (error) {
      throwIfAborted(state.signal)
      if (frameIndex === 0) throw error
      state.directoriesSkipped += 1
      continue
    }
    for (const entry of entries) {
      if (state.stopped) return
      if (entry.type === 'directory') {
        if (isSkippedDirectory(entry.name, state.limits.skippedDirectories)) continue
        if (frame.depth >= state.limits.maxDepth) {
          state.depthSkipped += 1
          continue
        }
        queue.push({ target: entry.target, depth: frame.depth + 1, segments: [...frame.segments, entry.name] })
        continue
      }
      if (entry.type !== 'file') continue
      collectFile(entry.target, frame.segments, entry.name, state)
    }
  }
}

/**
 * Run one path discovery through a `ctx.fs`-shaped seam.
 *
 * @param fs - the filesystem seam; only `listDir` is used for a directory root.
 * @param request - the discovery request.
 * @param request.matcher - the compiled pattern (see {@link compileGlob}).
 * @param request.root - the already-resolved search root.
 * @param request.rootType - the root's kind; a file root is a one-file candidate
 *   whose path relative to itself is its own name.
 * @param request.limits - the resolved caps and skip list.
 * @param request.signal - the per-call abort signal, when the caller supplied one.
 * @returns the matching file paths plus the counts the model-facing summary
 *   reports. The `truncated*` flags distinguish "the walk stopped early" from
 *   "the walk completed"; nothing is ever dropped silently.
 */
export async function runGlob(fs, request) {
  throwIfAborted(request.signal)
  const state = {
    limits: request.limits,
    matcher: request.matcher,
    signal: request.signal,
    files: [],
    filesSearched: 0,
    directoriesSkipped: 0,
    depthSkipped: 0,
    truncatedResults: false,
    truncatedFiles: false,
    stopped: false,
  }
  if (request.rootType === 'file') collectFile(request.root, [], basenameOf(request.root.displayPath), state)
  else await walkDirectories(fs, request.root, state)
  return {
    files: state.files,
    filesSearched: state.filesSearched,
    directoriesSkipped: state.directoriesSkipped,
    depthSkipped: state.depthSkipped,
    truncatedResults: state.truncatedResults,
    truncatedFiles: state.truncatedFiles,
  }
}

/** `file`/`files` for a count. */
function fileNoun(count) {
  return count === 1 ? 'file' : 'files'
}

/**
 * Render one discovery result as the model-facing `glob` text: one matching
 * path per line, a blank line, then a one-line summary naming the file count
 * and the file entries visited. Details are appended only when they apply
 * (unreadable directories, directories not entered past `maxDepth`), and a
 * global cap that stopped the walk early adds an explicit truncation sentence.
 *
 * @param result - the value returned by {@link runGlob}.
 * @param limits - the caps that produced it, so the summary can name the cap
 *   that was reached.
 * @returns the model-facing text: a body plus the trailing summary, or the
 *   summary alone when nothing matched.
 */
export function formatGlobResult(result, limits) {
  const details = [`files searched: ${result.filesSearched}`]
  if (result.directoriesSkipped > 0) details.push(`directories skipped as unreadable: ${result.directoriesSkipped}`)
  if (result.depthSkipped > 0) details.push(`directories not entered past maxDepth ${limits.maxDepth}: ${result.depthSkipped}`)
  const sentences = [`Found ${result.files.length} ${fileNoun(result.files.length)} (${details.join(', ')}).`]
  const reasons = []
  if (result.truncatedResults) reasons.push(`the maxResults cap of ${limits.maxResults} was reached`)
  if (result.truncatedFiles) reasons.push(`the maxFiles cap of ${limits.maxFiles} was reached`)
  if (reasons.length > 0) {
    sentences.push(`Results were truncated because ${reasons.join(' and ')}; narrow pattern or path and retry.`)
  }
  const body = result.files.join('\n')
  return body.length === 0 ? sentences.join(' ') : `${body}\n\n${sentences.join(' ')}`
}
