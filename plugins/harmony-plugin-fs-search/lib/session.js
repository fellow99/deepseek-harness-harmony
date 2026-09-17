/**
 * Session-scoped path resolution for the read-only `grep` tool: the calling
 * agent's per-session workspace is the base a relative `path` resolves
 * against, so each session searches its own workspace rather than the server's
 * launch directory. Mirrors `@deepseek-ai/dsh-tool-fs`'s `session-cwd` helper
 * (and `harmony-plugin-fs-mutate`'s `sandbox` helper) so every model-facing
 * filesystem tool resolves a relative path identically.
 *
 * Because this tool only READS, there is deliberately no escalation surface
 * here: reads are never fenced by `fs-sandbox` (only mutations are), so no
 * sandbox policy is resolved, stamped, or advertised.
 * @module harmony-plugin-fs-search/session
 */

import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

/** A path segment that traverses to a parent, in either separator dialect. */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The calling agent's per-session workspace cwd, or `undefined` for an
 * agent-less call (the backend then applies its own default).
 *
 * Parent traversal in either the cwd or the requested path makes a symlinked
 * cwd's filesystem identity observable, so only that case pays a
 * canonicalization round-trip.
 *
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve.
 * @returns the session cwd, canonicalized only on the traversal case.
 */
function sessionCwd(exec, requestedPath) {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options for one `ctx.fs.resolve` call.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @returns provider resolution options for the current call.
 */
export function sessionResolveOptions(exec, requestedPath) {
  const cwd = sessionCwd(exec, requestedPath)
  return {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  }
}
