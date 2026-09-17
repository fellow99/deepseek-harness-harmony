/**
 * The model-facing `copy` tool. Every read and write goes through `ctx.fs`, so
 * the mounted backend's sandbox fence applies and this plugin never touches the
 * host filesystem directly. The seam exposes no copy primitive, so a copy is the
 * same byte-faithful read-into-write the `move` tool performs, minus the removal;
 * sharing that planner keeps the two tools' containment, overwrite, and
 * empty-directory rules identical.
 * @module harmony-plugin-fs-mutate/copy
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './sandbox.js'
import { copyPlannedFiles, describeTreeRefusal, planTransferTree } from './transfer.js'

/**
 * Render a completed copy as one model-facing text block.
 * @param value - the canonical copy outcome.
 * @returns the model-facing confirmation.
 */
function formatCopyOutput(value) {
  return value.kind === 'file'
    ? `Copied "${value.from}" to "${value.to}".`
    : `Copied directory "${value.from}" to "${value.to}" (${value.files} files).`
}

/**
 * Register the `copy` tool.
 * @param ctx - the plugin context whose `fs` service performs the reads and writes.
 * @param sandbox - the shared escalation API (advertisement, mode stamping, denial mapping).
 * @param maxTransferBytes - inclusive per-file byte cap for the copy.
 */
export function applyCopyTool(ctx, sandbox, maxTransferBytes) {
  ctx.tools.register(defineTool({
    name: 'copy',
    description: 'Copy a file or directory. The copy never overwrites an existing destination file. Files are '
      + 'copied byte-for-byte, so binary content is preserved unchanged; a directory requires recursive: true, and a '
      + 'directory that would be empty at the destination is refused. Outside the session workspace a confining '
      + 'filesystem denies the copy.',
    parameters: {
      from: { type: 'string', required: true, description: 'Path to copy, resolved by the filesystem backend.' },
      to: { type: 'string', required: true, description: 'Destination path, resolved by the filesystem backend.' },
      recursive: { type: 'boolean', description: 'Required to copy a directory.' },
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
      render: (_args, value) => [{ type: 'text', text: formatCopyOutput(value) }],
    },
    async execute(args, exec) {
      if (args.from.trim().length === 0) throw new Error('from must be a non-empty string')
      if (args.to.trim().length === 0) throw new Error('to must be a non-empty string')
      // Resolve the escalation BEFORE the copy: a refused ask must not leave a
      // half-applied copy, and one grant covers every write of this call.
      const policy = await sandbox.resolvePolicy('copy', args, exec)
      const source = await ctx.fs.resolve(args.from, sessionResolveOptions(exec, args.from, policy?.workspaceRoot))
      const info = await ctx.fs.stat(source, exec.signal)
      if (info === undefined) throw new FsError(`cannot copy "${source.displayPath}": not found`, 'FS_NOT_FOUND')
      if (info.type === 'other') {
        throw new FsError(`cannot copy "${source.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
      }
      if (info.type === 'directory' && args.recursive !== true) {
        throw new Error(`cannot copy "${source.displayPath}": copying a directory requires recursive: true`)
      }
      const destination = await ctx.fs.resolve(args.to, sessionResolveOptions(exec, args.to, policy?.workspaceRoot))
      // A destination inside the source would nest a copy of the tree inside
      // itself; the seam's own containment test avoids comparing keys.
      if (ctx.fs.contains(source, destination)) {
        throw new FsError(
          `cannot copy "${source.displayPath}" to "${destination.displayPath}": the destination is the source itself or inside it`,
          'FS_IO_ERROR',
        )
      }
      const transfer = { signal: exec.signal, policy, maxTransferBytes }
      try {
        const plan = info.type === 'directory'
          ? await planTransferTree(ctx.fs, source, destination, transfer)
          : { files: [{ source, destination }], emptyDirectories: [], irregular: [] }
        const refusal = describeTreeRefusal('copy', source, plan)
        if (refusal !== null) throw new FsError(refusal.message, refusal.code)
        const files = await copyPlannedFiles(ctx.fs, plan, transfer)
        return { from: source.displayPath, to: destination.displayPath, kind: info.type, files }
      } catch (error) {
        throw sandbox.mapError(error, policy)
      }
    },
  }))
}
