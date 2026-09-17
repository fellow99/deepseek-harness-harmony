/**
 * Function plugin registering the model-facing `grep` tool: a pure-JavaScript,
 * recursive, caps-bounded content search over `ctx.fs`.
 *
 * The upstream `@deepseek-ai/dsh-tool-fs-search` `grep` spawns the packaged
 * `@vscode/ripgrep` native binary, which the HarmonyOS build cannot execute, so
 * this plugin replaces content search with an in-process walk of the same
 * filesystem seam. Every read goes through `ctx.fs`, so the mounted backend
 * keeps owning path identity, decoding, and binary rejection, and no native
 * module, subprocess, or `node:fs` handle is involved.
 *
 * Named exports only: a default export would make the Loader discard `inject`.
 * @module harmony-plugin-fs-search
 */

import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_LIMITS, compileInclude, formatSearchResult, runSearch } from './search.js'
import { sessionResolveOptions } from './session.js'

/** Plugin name used by loader diagnostics and preset rows. */
export const name = 'harmony-plugin-fs-search'

/** Services required before the tool registers. */
export const inject = ['tools', 'fs']

/**
 * Plugin config: every cap is optional and takes its {@link DEFAULT_LIMITS}
 * value. Unbounded values are refused in `apply`, because the walk reads real
 * files on a device and an uncapped one would run until the caller gives up.
 */
export const Config = z.object({
  maxResults: z.number().default(DEFAULT_LIMITS.maxResults),
  maxMatchesPerFile: z.number().default(DEFAULT_LIMITS.maxMatchesPerFile),
  maxFiles: z.number().default(DEFAULT_LIMITS.maxFiles),
  maxFileBytes: z.number().default(DEFAULT_LIMITS.maxFileBytes),
  maxDepth: z.number().default(DEFAULT_LIMITS.maxDepth),
  maxLineChars: z.number().default(DEFAULT_LIMITS.maxLineChars),
  skippedDirectories: z.array(z.string()).default([...DEFAULT_LIMITS.skippedDirectories]),
})

/**
 * Assert one numeric cap is a positive safe integer. A zero, a negative, a
 * fraction, and a value past `Number.MAX_SAFE_INTEGER` are all refused, since
 * each of them would either disable the bound or make it meaningless.
 * @param value - the configured cap.
 * @param key - the config key, quoted in the failure.
 * @returns the accepted cap.
 * @throws {Error} when the cap is not a positive safe integer.
 */
function positiveCap(value, key) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`harmony-plugin-fs-search: ${key} must be a positive safe integer`)
  }
  return value
}

/**
 * Validate the resolved config into the limits the search engine consumes.
 * @param config - the resolved plugin config (schemastery filled every default).
 * @returns the validated limits, with a private copy of the skip list.
 * @throws {Error} on an invalid cap or a malformed skip list.
 */
function resolveLimits(config) {
  const skippedDirectories = config.skippedDirectories
  if (!Array.isArray(skippedDirectories)
    || skippedDirectories.some(directory => typeof directory !== 'string' || directory.trim().length === 0)) {
    throw new Error('harmony-plugin-fs-search: skippedDirectories must be an array of non-empty directory names')
  }
  return {
    maxResults: positiveCap(config.maxResults, 'maxResults'),
    maxMatchesPerFile: positiveCap(config.maxMatchesPerFile, 'maxMatchesPerFile'),
    maxFiles: positiveCap(config.maxFiles, 'maxFiles'),
    maxFileBytes: positiveCap(config.maxFileBytes, 'maxFileBytes'),
    maxDepth: positiveCap(config.maxDepth, 'maxDepth'),
    maxLineChars: positiveCap(config.maxLineChars, 'maxLineChars'),
    skippedDirectories: [...skippedDirectories],
  }
}

/**
 * Render a directory-name list for the tool description.
 * @param names - the configured skip list.
 * @returns the names, each backticked, comma-separated.
 */
function quoteList(names) {
  return names.map(name => `\`${name}\``).join(', ')
}

/**
 * Register the `grep` tool over the mounted filesystem.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - the resolved plugin config (schemastery filled every default).
 * @throws {Error} when a configured cap is invalid.
 */
export function apply(ctx, config) {
  const limits = resolveLimits(config)
  const description = 'Search file contents recursively and return matching lines as `<path>:<line>: <line text>` with '
    + '1-based line numbers, followed by a summary of how many matches were found, how many files were searched, and how '
    + 'many files were skipped. This is a pure-JavaScript implementation replacing ripgrep: no native binary or '
    + 'subprocess is spawned, and `pattern` is a plain JavaScript regular expression source tested against one line at a '
    + `time (no flags are applied, so matching is case-sensitive). The walk skips ${quoteList(limits.skippedDirectories)} `
    + `and every dot-directory, descends at most ${limits.maxDepth} directory levels below the search root, returns at `
    + `most ${limits.maxResults} matches (at most ${limits.maxMatchesPerFile} per file) from at most ${limits.maxFiles} `
    + `files, cuts a matched line to ${limits.maxLineChars} characters, and skips any file larger than `
    + `${limits.maxFileBytes} bytes. A binary or unreadable file is skipped and counted, never fatal, and a capped `
    + 'result is reported as truncated instead of being dropped silently.'

  ctx.tools.register(defineTool({
    name: 'grep',
    description,
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'JavaScript regular expression source to test each line against. No flags are applied, so matching '
          + 'is case-sensitive and there is no case-insensitive switch.',
      },
      path: {
        type: 'string',
        description: 'File or directory to search. Defaults to the session workspace; a relative path resolves against it.',
      },
      include: {
        type: 'string',
        description: 'One filename glob filter selecting which files to search, supporting "*" and "?" (for example '
          + '"*.ts"). A filter with no "/" matches the file name at any depth. Negation, commas, and brace alternation are '
          + 'rejected.',
      },
      max_results: {
        type: 'integer',
        description: `Optional lower cap on the matches this call returns; a larger value is clamped to the tool's own cap of ${limits.maxResults}.`,
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      if (args.pattern.length === 0) throw new Error('pattern must be a non-empty string')
      if (args.path !== undefined && args.path.trim().length === 0) {
        throw new Error('path must be a non-empty string when given')
      }
      if (args.max_results !== undefined && (!Number.isSafeInteger(args.max_results) || args.max_results < 1)) {
        throw new Error('max_results must be a positive integer when given')
      }
      // Validate the filter before any I/O, so a malformed call fails without touching the filesystem.
      const include = args.include === undefined ? undefined : compileInclude(args.include)
      const searchLimits = {
        ...limits,
        maxResults: args.max_results === undefined ? limits.maxResults : Math.min(args.max_results, limits.maxResults),
      }
      const requestedPath = args.path ?? '.'
      const root = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec, requestedPath))
      const info = await ctx.fs.stat(root, exec.signal)
      if (info === undefined) throw new FsError(`cannot search "${root.displayPath}": not found`, 'FS_NOT_FOUND')
      if (info.type === 'other') {
        throw new FsError(`cannot search "${root.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
      }
      const result = await runSearch(ctx.fs, {
        pattern: args.pattern,
        root,
        rootType: info.type,
        include,
        limits: searchLimits,
        signal: exec.signal,
      })
      return formatSearchResult(result, searchLimits)
    },
  }))
}
