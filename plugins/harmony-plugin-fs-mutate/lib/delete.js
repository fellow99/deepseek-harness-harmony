/**
 * The model-facing `delete` tool. Every removal goes through `ctx.fs.remove`,
 * so the mounted backend's sandbox fence applies and this plugin never touches
 * the host filesystem directly.
 * @module harmony-plugin-fs-mutate/delete
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './sandbox.js'

/**
 * Render a batch outcome as one model-facing text block. Failures always name
 * the requested path and the verbatim error, because a denied path's error text
 * is what carries the escalation hint back to the model.
 * @param value - the canonical batch outcome.
 * @returns the model-facing report.
 */
function formatDeleteOutput(value) {
  const lines = []
  if (value.deleted.length > 0) {
    lines.push(`Deleted ${value.deleted.length} ${value.deleted.length === 1 ? 'path' : 'paths'}:`)
    for (const entry of value.deleted) lines.push(`- ${entry.path} (${entry.kind})`)
  }
  if (value.failed.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`Failed to delete ${value.failed.length} ${value.failed.length === 1 ? 'path' : 'paths'}:`)
    for (const entry of value.failed) lines.push(`- ${entry.path}: ${entry.error}`)
  }
  return lines.join('\n')
}

/**
 * Register the `delete` tool.
 * @param ctx - the plugin context whose `fs` service performs every removal.
 * @param sandbox - the shared escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyDeleteTool(ctx, sandbox) {
  ctx.tools.register(defineTool({
    name: 'delete',
    description: 'Delete files and directories. Each path resolves against the session workspace. Every path is '
      + 'attempted independently, so one failure never stops the rest; the result lists what was deleted and the '
      + 'exact error for every path that failed. A non-empty directory requires recursive: true. Outside the session '
      + 'workspace a confining filesystem denies the removal.',
    parameters: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Paths to delete, resolved by the filesystem backend.',
      },
      recursive: {
        type: 'boolean',
        description: 'Remove a directory together with its contents. Required for a non-empty directory; '
          + 'without it a non-empty directory is refused rather than emptied.',
      },
      ...sandbox.escalationFields(),
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['file', 'directory'] },
              },
            },
          },
          failed: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                error: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatDeleteOutput(value) }],
    },
    async execute(args, exec) {
      if (args.paths.length === 0) throw new Error('paths must contain at least one path')
      for (const path of args.paths) {
        if (path.trim().length === 0) throw new Error('paths must not contain an empty path')
      }
      // Resolve the escalation BEFORE the first removal: a granted mode must
      // cover the whole batch, and a refusal must not leave it half-applied.
      const policy = await sandbox.resolvePolicy('delete', args, exec)
      const recursive = args.recursive === true
      const deleted = []
      const failed = []
      for (const path of args.paths) {
        try {
          const target = await ctx.fs.resolve(path, sessionResolveOptions(exec, path, policy?.workspaceRoot))
          const outcome = await ctx.fs.remove(target, { recursive, signal: exec.signal }, policy)
          deleted.push({ path: outcome.path, kind: outcome.kind })
        } catch (error) {
          // The caller cancelled: stop the batch and let the registry own the
          // cancellation outcome instead of reporting it as a per-path failure.
          if (exec.signal.aborted) throw error
          const mapped = sandbox.mapError(error, policy)
          failed.push({ path, error: mapped instanceof Error ? mapped.message : String(mapped) })
        }
      }
      return { deleted, failed }
    },
  }))
}
