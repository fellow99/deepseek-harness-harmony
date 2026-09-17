/**
 * Function plugin registering the model-facing `delete`, `move`, `copy`, and
 * `chmod` filesystem tools. Every one routes its mutations through `ctx.fs` — the
 * seam that owns target identity, atomicity, and the sandbox fence — so this
 * plugin never opens a path itself. Named exports only: a default export would
 * make the Loader discard `inject`.
 * @module harmony-plugin-fs-mutate
 */

import z from '@deepseek-ai/schemastery'
import { FsMutationSandbox } from './sandbox.js'
import { applyChmodTool } from './chmod.js'
import { applyCopyTool } from './copy.js'
import { applyDeleteTool } from './delete.js'
import { applyMoveTool } from './move.js'

/** Plugin name used by loader diagnostics and preset rows. */
export const name = 'harmony-plugin-fs-mutate'

/** Services required before any tool registers. */
export const inject = ['tools', 'fs']

/**
 * Default per-file byte cap for the `copy` and `move` copies. Mirrors
 * `dsh-fs-local`'s `diffBasisMaxBytes` default, the existing precedent for how
 * much text one whole-file operation buffers; `readBytes` makes a cap mandatory
 * so a backend never buffers an unbounded file.
 */
export const DEFAULT_MAX_TRANSFER_BYTES = 10 * 1024 * 1024

/** Plugin config; every key is optional and the defaults above apply. */
export const Config = z.object({
  maxTransferBytes: z.number().default(DEFAULT_MAX_TRANSFER_BYTES),
})

/**
 * Register every tool over the mounted filesystem.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - the resolved plugin config (schemastery filled every default).
 */
export function apply(ctx, config) {
  const maxTransferBytes = config.maxTransferBytes
  if (!Number.isSafeInteger(maxTransferBytes) || maxTransferBytes < 1) {
    throw new Error('harmony-plugin-fs-mutate: maxTransferBytes must be a positive safe integer')
  }
  const sandbox = new FsMutationSandbox(ctx)
  applyDeleteTool(ctx, sandbox)
  applyMoveTool(ctx, sandbox, maxTransferBytes)
  applyCopyTool(ctx, sandbox, maxTransferBytes)
  applyChmodTool(ctx, sandbox)
}
