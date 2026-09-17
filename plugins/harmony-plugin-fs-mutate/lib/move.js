/**
 * The model-facing `move` tool: a fenced copy of the source followed by a
 * fenced removal of the source. `ctx.fs` exposes no rename, and hmdfs (the
 * HarmonyOS filesystem behind the shipped product) documents its rename as
 * same-directory only, so copy-then-remove is the portable implementation; the
 * source is removed only after the copy succeeded. Each copied file travels as
 * raw bytes (`readBytes` into `writeBytes`), so binary content moves unchanged.
 * The planner is shared with the `copy` tool, so both enforce identical
 * containment, overwrite, and empty-directory rules.
 * @module harmony-plugin-fs-mutate/move
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './sandbox.js'
import { copyPlannedFiles, describeTreeRefusal, planTransferTree } from './transfer.js'

/**
 * Render a completed move as one model-facing text block.
 * @param value - the canonical move outcome.
 * @returns the model-facing confirmation.
 */
function formatMoveOutput(value) {
  return value.kind === 'file'
    ? `Moved "${value.from}" to "${value.to}".`
    : `Moved directory "${value.from}" to "${value.to}" (${value.files} files).`
}

/**
 * Register the `move` tool.
 * @param ctx - the plugin context whose `fs` service performs both mutations.
 * @param sandbox - the shared escalation API (advertisement, mode stamping, denial mapping).
 * @param maxTransferBytes - inclusive per-file byte cap for the copy.
 */
export function applyMoveTool(ctx, sandbox, maxTransferBytes) {
  ctx.tools.register(defineTool({
    name: 'move',
    description: 'Move or rename a file or directory by copying it to `to` and then deleting `from`. The copy '
      + 'never overwrites an existing destination file, and the source is deleted only after the copy succeeded. Files '
      + 'are copied byte-for-byte, so binary content moves unchanged; a directory requires recursive: true, and a '
      + 'directory that would be empty at the destination is refused. Outside the session workspace a confining '
      + 'filesystem denies the copy and the removal.',
    parameters: {
      from: { type: 'string', required: true, description: 'Path to move, resolved by the filesystem backend.' },
      to: { type: 'string', required: true, description: 'Destination path, resolved by the filesystem backend.' },
      recursive: { type: 'boolean', description: 'Required to move a directory.' },
      ...sandbox.escalationFields(),
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: ['file', 'directory'] },
          files: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatMoveOutput(value) }],
    },
    async execute(args, exec) {
      if (args.from.trim().length === 0) throw new Error('from must be a non-empty string')
      if (args.to.trim().length === 0) throw new Error('to must be a non-empty string')
      // Resolve the escalation BEFORE the copy: a refused ask must not leave a
      // half-applied move, and one grant covers both mutations of this call.
      const policy = await sandbox.resolvePolicy('move', args, exec)
      const source = await ctx.fs.resolve(args.from, sessionResolveOptions(exec, args.from, policy?.workspaceRoot))
      const info = await ctx.fs.stat(source, exec.signal)
      if (info === undefined) throw new FsError(`cannot move "${source.displayPath}": not found`, 'FS_NOT_FOUND')
      if (info.type === 'other') {
        throw new FsError(`cannot move "${source.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
      }
      if (info.type === 'directory' && args.recursive !== true) {
        throw new Error(`cannot move "${source.displayPath}": moving a directory requires recursive: true`)
      }
      const destination = await ctx.fs.resolve(args.to, sessionResolveOptions(exec, args.to, policy?.workspaceRoot))
      // A destination inside the source would be copied and then deleted along
      // with the source; the seam's own containment test avoids comparing keys.
      if (ctx.fs.contains(source, destination)) {
        throw new FsError(
          `cannot move "${source.displayPath}" to "${destination.displayPath}": the destination is the source itself or inside it`,
          'FS_IO_ERROR',
        )
      }
      const transfer = { signal: exec.signal, policy, maxTransferBytes }
      try {
        const plan = info.type === 'directory'
          ? await planTransferTree(ctx.fs, source, destination, transfer)
          : { files: [{ source, destination }], emptyDirectories: [], irregular: [] }
        const refusal = describeTreeRefusal('move', source, plan)
        if (refusal !== null) throw new FsError(refusal.message, refusal.code)
        const files = await copyPlannedFiles(ctx.fs, plan, transfer)
        await ctx.fs.remove(source, { recursive: info.type === 'directory', signal: exec.signal }, policy)
        return { from: source.displayPath, to: destination.displayPath, kind: info.type, files }
      } catch (error) {
        throw sandbox.mapError(error, policy)
      }
    },
  }))
}
