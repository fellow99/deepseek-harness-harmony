/**
 * Pure, dependency-free content-search engine behind the `grep` tool: a
 * breadth-first recursive walk over a `ctx.fs`-shaped seam that reports one
 * match per matching line.
 *
 * The module imports nothing — no `@deepseek-ai/*`, no `node:fs`, no glob
 * package — so it runs against any object exposing `stat`, `listDir`, and
 * `readText` (which is what makes it unit-testable against an in-memory
 * filesystem). Every cap arrives from the caller; {@link DEFAULT_LIMITS} is
 * this plugin's own default set.
 *
 * Deliberate semantics:
 * - a match is a LINE match: the `pattern` is compiled with no flags and
 *   tested against each line, so it is case-sensitive and a pattern that can
 *   only match across a newline never matches;
 * - the walk is breadth-first in the backend's stable name order, so a capped
 *   result samples the shallow end of the tree instead of one deep subtree;
 * - a directory whose name is excluded, or which would exceed `maxDepth`, is
 *   never listed at all, and the explicitly named search root is always walked
 *   even when its own name is excluded;
 * - an unreadable file (binary content, a vanished entry, a permission error,
 *   a file over `maxFileBytes`) is SKIPPED and counted, never fatal.
 * @module harmony-plugin-fs-search/search
 */

/**
 * The plugin's default caps and skip list. Every value is overridable through
 * the plugin `Config`; see `lib/index.js`.
 *
 * `maxResults` × (`maxLineChars` + one path) is the worst-case inline output
 * (200 × ~360 ≈ 72 KB), and `maxFiles` × `maxFileBytes` bounds the bytes the
 * walk can ever buffer, because a larger file is skipped instead of read.
 */
export const DEFAULT_LIMITS = {
  /** Total matches retained from one call; the walk stops when the next match would exceed it. */
  maxResults: 200,
  /** Matches retained from any single file; further matches in that file are dropped and counted. */
  maxMatchesPerFile: 50,
  /** Files read in one call; the walk stops when the next file would exceed it. */
  maxFiles: 2000,
  /** Inclusive byte cap per file: a larger file is skipped before it is read. */
  maxFileBytes: 512 * 1024,
  /**
   * Directory levels descended below the search root. The root itself is level
   * 0, so `1` searches the root and its immediate subdirectories, and `0` is
   * rejected by the plugin (a positive cap is required).
   */
  maxDepth: 8,
  /** Characters kept per matched line before the line is cut and marked. */
  maxLineChars: 300,
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
 * Compile the model-facing `pattern` argument into a line matcher.
 *
 * No flags are applied, which keeps `RegExp.test` stateless (`lastIndex` is
 * only meaningful for the `g`/`y` flags) and makes the result reproducible
 * across calls.
 *
 * @param pattern - the JavaScript regular expression source.
 * @returns a flagless `RegExp`; an empty source matches every line.
 * @throws {Error} when the source is not a valid JavaScript regular expression.
 */
function compilePattern(pattern) {
  try {
    return new RegExp(pattern)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`pattern is not a valid JavaScript regular expression: ${detail}`)
  }
}

/**
 * Translate one `include` glob into an anchored, separator-aware matcher.
 *
 * Only `*` and `?` are wildcards, and neither crosses a directory separator.
 * A double-star directory segment matches zero or more directories, so
 * `**` followed by a separator then `*.ts` matches a `.ts` file at any depth,
 * the root included. Every other character is literal. Backslashes are
 * normalized to `/`, so a Windows-style filter (`src\*.ts`) behaves like
 * `src/*.ts`.
 *
 * @param glob - the model-facing `include` filter.
 * @returns the compiled matcher.
 * @throws {Error} for a blank filter, a negated filter, a comma-separated list,
 *   or brace alternation (which this implementation deliberately does not
 *   support, so the failure is loud instead of a silent zero-match search).
 */
export function compileInclude(glob) {
  if (glob.trim().length === 0) throw new Error('include must be a non-empty glob when given')
  if (glob.startsWith('!')) {
    throw new Error('include must be a positive glob filter; negated patterns ("!…") are not supported')
  }
  const normalized = glob.replaceAll('\\', '/')
  if (normalized.includes('{') || normalized.includes('}')) {
    throw new Error('include supports only "*" and "?" wildcards; brace alternation (e.g. "*.{ts,tsx}") is not supported')
  }
  if (normalized.includes(',')) {
    throw new Error('include must be one glob, not a comma-separated list')
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
 * Whether `include` admits one file entry. A filter with no separator matches
 * the basename at any depth (the ripgrep convention); one with a separator
 * matches the path relative to the search root, always with `/` separators.
 * @param include - the compiled filter.
 * @param segments - the directory segments between the root and the file's directory.
 * @param name - the file's entry name.
 * @returns true when the file should be searched.
 */
function includeMatches(include, segments, name) {
  if (include.onBasename) return include.regex.test(name)
  const relativePath = segments.length === 0 ? name : `${segments.join('/')}/${name}`
  return include.regex.test(relativePath)
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
 * Stop the walk on cancellation. The search is a read loop with no deadline of
 * its own, so `exec.signal` is the only bound on a call the caller abandoned.
 * @param signal - the per-call abort signal, when the caller supplied one.
 * @throws {Error} when the signal is already aborted.
 */
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw new Error('grep was aborted (tool timeout or caller cancellation)')
}

/**
 * Search one file and append its matches to the shared walk state.
 *
 * The file is skipped, and counted, when it cannot be read: absent metadata,
 * no longer a regular file, over `maxFileBytes`, or a `readText` rejection
 * (binary content, permission, I/O). Nothing here throws for an unreadable
 * file — only cancellation and an abort do.
 *
 * @param fs - the `ctx.fs`-shaped seam.
 * @param file - the resolved file target.
 * @param state - the mutable walk state (see {@link runSearch}).
 */
async function searchFile(fs, file, state) {
  const { limits, matcher, signal } = state
  throwIfAborted(signal)
  if (state.filesSearched >= limits.maxFiles) {
    state.truncatedFiles = true
    state.stopped = true
    return
  }
  let info
  try {
    info = await fs.stat(file, signal)
  } catch {
    throwIfAborted(signal)
    state.filesSkipped += 1
    return
  }
  if (info === undefined || info.type !== 'file') {
    state.filesSkipped += 1
    return
  }
  if (typeof info.size === 'number' && info.size > limits.maxFileBytes) {
    state.filesSkipped += 1
    return
  }
  let text
  try {
    text = await fs.readText(file, signal)
  } catch {
    throwIfAborted(signal)
    state.filesSkipped += 1
    return
  }
  state.filesSearched += 1
  const lines = text.split('\n')
  let fileMatches = 0
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!matcher.test(line)) continue
    if (state.matches.length >= limits.maxResults) {
      state.truncatedResults = true
      state.stopped = true
      return
    }
    state.matches.push({
      path: file.displayPath,
      lineNumber: index + 1,
      line: line.length > limits.maxLineChars
        ? `${line.slice(0, limits.maxLineChars)}... (line truncated to ${limits.maxLineChars} chars)`
        : line,
    })
    fileMatches += 1
    if (fileMatches >= limits.maxMatchesPerFile) {
      state.truncatedLines += 1
      break
    }
  }
}

/**
 * Walk a directory tree breadth-first and append matches to the shared state.
 *
 * A subdirectory that cannot be listed (permission, I/O) is counted and
 * skipped; the search root's own listing failure propagates unchanged, because
 * the caller named that path and must learn it is unusable.
 *
 * @param fs - the `ctx.fs`-shaped seam.
 * @param root - the resolved root directory target.
 * @param state - the mutable walk state (see {@link runSearch}).
 */
async function walkDirectories(fs, root, state) {
  const queue = [{ target: root, depth: 0, segments: [] }]
  for (let frameIndex = 0; frameIndex < queue.length; frameIndex += 1) {
    if (state.stopped) return
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
      if (state.include !== undefined && !includeMatches(state.include, frame.segments, entry.name)) continue
      await searchFile(fs, entry.target, state)
    }
  }
}

/**
 * Run one content search through a `ctx.fs`-shaped seam.
 *
 * @param fs - the filesystem seam; only `stat`, `listDir`, and `readText` are used.
 * @param request - the search request.
 * @param request.pattern - a JavaScript regular expression source, tested per line.
 * @param request.root - the already-resolved search root.
 * @param request.rootType - the root's kind, so a file root searches exactly that file.
 * @param request.include - the compiled `include` matcher, or `undefined` for every file.
 * @param request.limits - the resolved caps and skip list.
 * @param request.signal - the per-call abort signal, when the caller supplied one.
 * @returns the matches plus the counts the model-facing summary reports. The
 *   `truncated*` flags distinguish "the search stopped early" from "the walk
 *   completed"; nothing is ever dropped silently.
 */
export async function runSearch(fs, request) {
  const state = {
    limits: request.limits,
    matcher: compilePattern(request.pattern),
    include: request.include,
    signal: request.signal,
    matches: [],
    filesSearched: 0,
    filesSkipped: 0,
    directoriesSkipped: 0,
    depthSkipped: 0,
    truncatedResults: false,
    truncatedFiles: false,
    truncatedLines: 0,
    stopped: false,
  }
  if (request.rootType === 'file') await searchFile(fs, request.root, state)
  else await walkDirectories(fs, request.root, state)
  return {
    matches: state.matches,
    filesSearched: state.filesSearched,
    filesSkipped: state.filesSkipped,
    directoriesSkipped: state.directoriesSkipped,
    depthSkipped: state.depthSkipped,
    truncatedResults: state.truncatedResults,
    truncatedFiles: state.truncatedFiles,
    truncatedLines: state.truncatedLines,
  }
}

/** `match`/`matches` for a count. */
function matchNoun(count) {
  return count === 1 ? 'match' : 'matches'
}

/** `file`/`files` for a count. */
function fileNoun(count) {
  return count === 1 ? 'file' : 'files'
}

/**
 * Render one search result as the model-facing `grep` text: one
 * `<displayPath>:<lineNumber>: <line text>` row per match, then a summary
 * sentence naming the match count, the files searched, and every kind of file
 * the walk skipped — followed, only when a global cap stopped the search
 * early, by an explicit truncation sentence.
 *
 * @param result - the value returned by {@link runSearch}.
 * @param limits - the caps that produced it, so the summary can name the cap
 *   that was reached.
 * @returns the model-facing text: a body plus the trailing summary, or the
 *   summary alone when nothing matched.
 */
export function formatSearchResult(result, limits) {
  const matchedFiles = new Set(result.matches.map(match => match.path)).size
  const details = [`files searched: ${result.filesSearched}`]
  if (result.filesSkipped > 0) details.push(`files skipped as unreadable or too large: ${result.filesSkipped}`)
  if (result.directoriesSkipped > 0) details.push(`directories skipped as unreadable: ${result.directoriesSkipped}`)
  if (result.depthSkipped > 0) details.push(`directories not entered past maxDepth ${limits.maxDepth}: ${result.depthSkipped}`)
  if (result.truncatedLines > 0) {
    details.push(`${fileNoun(result.truncatedLines)} past the ${limits.maxMatchesPerFile}-matches-per-file cap: ${result.truncatedLines}`)
  }
  const sentences = [
    `Found ${result.matches.length} ${matchNoun(result.matches.length)} in `
      + `${matchedFiles} ${fileNoun(matchedFiles)} (${details.join(', ')}).`,
  ]
  const reasons = []
  if (result.truncatedResults) reasons.push(`the maxResults cap of ${limits.maxResults} was reached`)
  if (result.truncatedFiles) reasons.push(`the maxFiles cap of ${limits.maxFiles} was reached`)
  if (reasons.length > 0) {
    sentences.push(`Results were truncated because ${reasons.join(' and ')}; narrow pattern, path, or include and retry.`)
  }
  const body = result.matches
    .map(match => `${match.path}:${match.lineNumber}: ${match.line}`)
    .join('\n')
  return body.length === 0 ? sentences.join(' ') : `${body}\n\n${sentences.join(' ')}`
}
