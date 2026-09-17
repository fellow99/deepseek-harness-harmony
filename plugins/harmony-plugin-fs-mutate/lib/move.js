/**
 * The model-facing `move` tool: a fenced copy of the source followed by a
 * fenced removal of the source. `ctx.fs` exposes no rename, and hmdfs (the
 * HarmonyOS filesystem behind the shipped product) documents its rename as
 * same-directory only, so copy-then-remove is the portable implementation; the
 * source is removed only after the copy succeeded.
 * @module harmony-plugin-fs-mutate/move
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './sandbox.js'

/** `writeText` is text-only, so a copy decodes strictly and fails on binary input. */
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Decode one copied file, mapping the decoder's `TypeError` to the seam's own
 * `FS_NOT_TEXT` vocabulary rather than writing a corrupt copy.
 * @param bytes - the source file's complete bytes.
 * @param displayPath - the source's model-facing path, quoted in the error.
 * @returns the decoded UTF-8 text.
 */
function decodeCopy(bytes, displayPath) {
  try {
    return UTF8.decode(bytes)
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    throw new FsError(
      `cannot move "${displayPath}": invalid UTF-8 text, and this filesystem seam can copy only text files`,
      'FS_NOT_TEXT',
    )
  }
}

/**
 * Plan a destination tree without mutating anything: every regular file below
 * the source paired with the destination target to write it to, plus every
 * directory that would be empty. `resolve` accepts a not-yet-existing cwd, so
 * the whole plan is built before the first write.
 * @param ctx - the plugin context whose `fs` service is walked.
 * @param source - the resolved source directory.
 * @param destination - the resolved destination directory.
 * @param transfer - the per-call signal, policy, and byte cap.
 * @returns the file pairs and the display paths of the empty directories.
 */
async function planTree(ctx, source, destination, transfer) {
  const files = []
  const emptyDirectories = []
  async function visit(sourceDirectory, destinationDirectory) {
    const entries = await ctx.fs.listDir(sourceDirectory, transfer.signal)
    if (entries.length === 0) {
      emptyDirectories.push(sourceDirectory.displayPath)
      return
    }
    for (const entry of entries) {
      const childDestination = await ctx.fs.resolve(
        entry.name,
        { cwd: destinationDirectory.displayPath, signal: transfer.signal },
      )
      if (entry.type === 'directory') {
        await visit(entry.target, childDestination)
        continue
      }
      if (entry.type !== 'file') {
        throw new FsError(`cannot move "${entry.target.displayPath}": not a regular file or directory`, 'FS_NOT_REGULAR_FILE')
      }
      files.push({ source: entry.target, destination: childDestination })
    }
  }
  await visit(source, destination)
  return { files, emptyDirectories }
}

/**
 * Refuse a tree the seam cannot reproduce BEFORE anything is copied. `ctx.fs`
 * exposes no directory-creation primitive, so a destination directory exists
 * only as a side effect of writing a file into it — an empty directory has
 * nothing to write, and dropping it silently would lose structure.
 * @param source - the resolved source directory.
 * @param plan - the planned file pairs and empty directories.
 */
function assertReproducible(source, plan) {
  if (plan.emptyDirectories.length === 0) return
  throw new FsError(
    `cannot move "${source.displayPath}": ${plan.emptyDirectories.map(path => `"${path}"`).join(', ')} `
      + 'would be empty at the destination, and this filesystem seam cannot create a directory without a file',
    'FS_IO_ERROR',
  )
}

/**
 * Write every planned file with `createIfAbsent`, so an existing destination
 * file fails the move instead of being overwritten. Passing the per-call
 * sandbox policy makes each write fenced by the mounted backend.
 * @param ctx - the plugin context whose `fs` service performs the copy.
 * @param plan - the planned source/destination file pairs.
 * @param transfer - the per-call signal, policy, and byte cap.
 * @returns the number of files written.
 */
async function copyFiles(ctx, plan, transfer) {
  for (const file of plan.files) {
    const bytes = await ctx.fs.readBytes(file.source, transfer.signal, transfer.maxTransferBytes)
    await ctx.fs.writeText(
      file.destination,
      decodeCopy(bytes, file.source.displayPath),
      { kind: 'createIfAbsent' },
      transfer.signal,
      transfer.policy,
    )
  }
  return plan.files.length
}

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
      + 'never overwrites an existing destination file, and the source is deleted only after the copy succeeded. Only '
      + 'UTF-8 text files can be copied; a directory requires recursive: true, and a directory that would be empty at '
      + 'the destination is refused. Outside the session workspace a confining filesystem denies the copy and the '
      + 'removal.',
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
          ? await planTree(ctx, source, destination, transfer)
          : { files: [{ source, destination }], emptyDirectories: [] }
        assertReproducible(source, plan)
        const files = await copyFiles(ctx, plan, transfer)
        await ctx.fs.remove(source, { recursive: info.type === 'directory', signal: exec.signal }, policy)
        return { from: source.displayPath, to: destination.displayPath, kind: info.type, files }
      } catch (error) {
        throw sandbox.mapError(error, policy)
      }
    },
  }))
}
