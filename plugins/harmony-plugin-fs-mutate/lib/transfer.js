/**
 * Shared tree-walk and byte-copy mechanics for the `copy` and `move` tools.
 * Deliberately import-free — no dsh package, no `node:fs`: both tools drive it
 * through the `ctx.fs` service they are handed, so the planner is unit-testable
 * on plain Node against an in-memory stub, and neither tool can reach the host
 * filesystem directly. Refusals are returned as data (message + seam error code)
 * rather than thrown, so the caller owns error construction and this module stays
 * free of the seam's vocabulary.
 * @module harmony-plugin-fs-mutate/transfer
 */

/**
 * Plan a destination tree without mutating anything: every regular file below the
 * source paired with the destination target to write it to, the display paths of
 * the directories that would be empty, and the display paths of entries that are
 * neither a regular file nor a directory. `resolve` accepts a not-yet-existing
 * cwd, so the whole plan is built before the first write.
 * @param fs - the `ctx.fs` service to walk.
 * @param source - the resolved source directory.
 * @param destination - the resolved destination directory.
 * @param transfer - the per-call `signal`.
 * @returns the file pairs, the empty directories, and the irregular entries.
 */
export async function planTransferTree(fs, source, destination, transfer) {
  const files = []
  const emptyDirectories = []
  const irregular = []
  async function visit(sourceDirectory, destinationDirectory) {
    const entries = await fs.listDir(sourceDirectory, transfer.signal)
    if (entries.length === 0) {
      emptyDirectories.push(sourceDirectory.displayPath)
      return
    }
    for (const entry of entries) {
      const childDestination = await fs.resolve(
        entry.name,
        { cwd: destinationDirectory.displayPath, signal: transfer.signal },
      )
      if (entry.type === 'directory') {
        await visit(entry.target, childDestination)
        continue
      }
      if (entry.type !== 'file') {
        irregular.push(entry.target.displayPath)
        continue
      }
      files.push({ source: entry.target, destination: childDestination })
    }
  }
  await visit(source, destination)
  return { files, emptyDirectories, irregular }
}

/**
 * Describe why a planned tree cannot be reproduced, or return null when it can.
 * `ctx.fs` exposes no directory-creation primitive, so a destination directory
 * exists only as a side effect of writing a file into it: an empty directory has
 * nothing to write, and dropping it silently would lose structure. The caller
 * raises the returned code, so each tool keeps its own verb in the message.
 * @param verb - the operation's imperative verb (`copy`, `move`) for the message.
 * @param source - the resolved source directory.
 * @param plan - the plan returned by {@link planTransferTree}.
 * @returns the refusal message and seam error code, or null.
 */
export function describeTreeRefusal(verb, source, plan) {
  if (plan.irregular.length > 0) {
    return {
      code: 'FS_NOT_REGULAR_FILE',
      message: `cannot ${verb} "${plan.irregular[0]}": not a regular file or directory`,
    }
  }
  if (plan.emptyDirectories.length > 0) {
    return {
      code: 'FS_IO_ERROR',
      message: `cannot ${verb} "${source.displayPath}": ${plan.emptyDirectories.map(path => `"${path}"`).join(', ')} `
        + 'would be empty at the destination, and this filesystem seam cannot create a directory without a file',
    }
  }
  return null
}

/**
 * Write every planned file with `createIfAbsent`, so an existing destination file
 * fails the transfer instead of being overwritten. Passing the per-call sandbox
 * policy makes each write fenced by the mounted backend.
 * @param fs - the `ctx.fs` service performing the copy.
 * @param plan - the planned source/destination file pairs.
 * @param transfer - the per-call `signal`, `policy`, and `maxTransferBytes`.
 * @returns the number of files written.
 */
export async function copyPlannedFiles(fs, plan, transfer) {
  for (const file of plan.files) {
    const bytes = await fs.readBytes(file.source, transfer.signal, transfer.maxTransferBytes)
    await fs.writeBytes(
      file.destination,
      bytes,
      { kind: 'createIfAbsent' },
      transfer.signal,
      transfer.policy,
    )
  }
  return plan.files.length
}
