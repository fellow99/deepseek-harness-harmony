/**
 * The model-facing `chmod` tool. Every change goes through `ctx.fs.chmod`, so the
 * mounted backend's sandbox fence applies and this plugin never calls `node:fs`.
 * The seam's `chmod` reads the bits back, so a storage layer that accepts the
 * call while ignoring the mode surfaces here as a failure instead of a silent
 * success — which is the observed behavior of the HarmonyOS shared user mounts
 * behind the shipped product.
 * @module harmony-plugin-fs-mutate/chmod
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatPermissionMode, parsePermissionMode } from './permissions.js'
import { sessionResolveOptions } from './sandbox.js'

/**
 * Render a completed permission change as one model-facing text block.
 * @param value - the canonical chmod outcome.
 * @returns the model-facing confirmation.
 */
function formatChmodOutput(value) {
  return `Set mode ${value.mode} on "${value.path}".`
}

/**
 * Register the `chmod` tool.
 * @param ctx - the plugin context whose `fs` service performs the change.
 * @param sandbox - the shared escalation API (advertisement, mode stamping, denial mapping).
 */
export function applyChmodTool(ctx, sandbox) {
  ctx.tools.register(defineTool({
    name: 'chmod',
    description: 'Set the POSIX permission bits of a file or directory. `mode` is three or four octal digits, for '
      + 'example "644" or "0755". The bits are read back and verified after the change: a filesystem that accepts the '
      + 'call without honoring permission bits is reported as a failure, never as a silent success. Outside the '
      + 'session workspace a confining filesystem denies the change.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path to change, resolved by the filesystem backend.' },
      mode: {
        type: 'string',
        required: true,
        description: 'Permission bits as three or four octal digits, for example "644" or "0755".',
      },
      ...sandbox.escalationFields(),
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          mode: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatChmodOutput(value) }],
    },
    async execute(args, exec) {
      if (args.path.trim().length === 0) throw new Error('path must be a non-empty string')
      // Validate the mode before resolving anything: a malformed mode is a caller
      // error, not a filesystem outcome, and must not reach the approval channel.
      const parsed = parsePermissionMode(args.mode)
      if (parsed.error !== undefined) throw new Error(parsed.error)
      const policy = await sandbox.resolvePolicy('chmod', args, exec)
      try {
        const target = await ctx.fs.resolve(args.path, sessionResolveOptions(exec, args.path, policy?.workspaceRoot))
        const outcome = await ctx.fs.chmod(target, parsed.mode, { signal: exec.signal }, policy)
        return { path: outcome.path, mode: formatPermissionMode(outcome.mode) }
      } catch (error) {
        throw sandbox.mapError(error, policy)
      }
    },
  }))
}
