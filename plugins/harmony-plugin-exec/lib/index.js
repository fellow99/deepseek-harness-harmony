/**
 * Function plugin registering the model-facing `bash` tool over one resident,
 * non-PTY `/system/bin/sh` session.
 *
 * Named exports only: a default export would make the Loader discard `inject`.
 * The upstream `tool-bash` preset row stays disabled (it needs the win32-x64
 * `node-pty` artifact); this plugin is mounted as a separate `exec` row.
 * @module harmony-plugin-exec
 */

import z from '@deepseek-ai/schemastery'
import { B_CLASS } from './inventory.js'
import { DEFAULT_DENY_COMMANDS } from './fence.js'
import { nameSet, resolveLimits } from './config.js'
import { ShellSession } from './session.js'
import { ExecSandbox, applyBashTool } from './bash.js'

/** Plugin name used by loader diagnostics and preset rows. */
export const name = 'harmony-plugin-exec'

/** Services required before the tool registers. */
export const inject = ['tools', 'fs']

// Re-export the pure validators here so this module owns its config surface;
// the implementations live in the import-free `./config.js` so
// `tests/index.test.mjs` can drive them without resolving the dsh packages.
export { positiveInteger, nameSet, resolveLimits } from './config.js'

/** Spec FR-5.1 defaults; every value is overridable from cordis.yml. */
export const DEFAULTS = Object.freeze({
  commandTimeoutMs: 120000,
  maxOutputBytes: 262144,
  maxCommandChars: 65536,
  fenceMode: 'enforce',
  commandPolicy: 'disclose-only',
  shellPath: '/system/bin/sh',
})

/**
 * Plugin config. The three numeric limits are validated as positive safe
 * integers in `apply`; the enum fields are pinned by the schema. `shellPath`
 * accepts a known-spawnable target only by convention — executability is never
 * probed with a synchronous stat (EACCES false negative, spec FR-6.5).
 */
export const Config = z.object({
  commandTimeoutMs: z.number().default(DEFAULTS.commandTimeoutMs),
  maxOutputBytes: z.number().default(DEFAULTS.maxOutputBytes),
  maxCommandChars: z.number().default(DEFAULTS.maxCommandChars),
  fenceMode: z.union(['enforce', 'warn', 'off']).default(DEFAULTS.fenceMode),
  commandPolicy: z.union(['disclose-only', 'allowlist', 'denylist']).default(DEFAULTS.commandPolicy),
  shellPath: z.string().default(DEFAULTS.shellPath),
  allowCommands: z.array(z.string()).default([]),
  denyCommands: z.array(z.string()).default([...DEFAULT_DENY_COMMANDS]),
  toyboxApplets: z.array(z.string()).default([...B_CLASS]),
})

/** Emit a warning through the host logger, falling back to the console. */
function warn(ctx, message) {
  if (ctx.logger !== undefined && typeof ctx.logger.warn === 'function') {
    ctx.logger.warn(message)
    return
  }
  console.warn(message)
}

/**
 * Register the `bash` tool and own the resident session lifetime.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - the resolved plugin config (schemastery filled every default).
 * @throws {Error} when a numeric limit is not a positive safe integer, or when
 *   the mounted filesystem confines without `ctx.sandboxPolicy`.
 */
export function apply(ctx, config) {
  const limits = resolveLimits(config)
  if (typeof config.shellPath !== 'string' || config.shellPath.trim().length === 0) {
    throw new Error('harmony-plugin-exec: shellPath must be a non-empty string')
  }

  // A downgraded fence must be announced loudly; a silent downgrade would look
  // like a working fence (spec FR-3.7 / §6.5).
  if (config.fenceMode !== 'enforce') {
    warn(ctx, `[dsh-harmony] harmony-plugin-exec: fenceMode=${config.fenceMode} — the tool-layer path fence is `
      + 'DOWNGRADED. This is an explicit security downgrade: the resident shell retains full application-uid '
      + 'file access and the fence is no longer a denial gate.')
  }

  // `cwd` is deliberately NOT seeded here: the resident shell must start in the
  // SESSION WORKSPACE (spec FR-1.7/FR-6.6), and `ShellSession.run()` seeds it
  // from the first call's `options.cwd`. Seeding the host working directory
  // would silently spawn in the wrong place and desynchronize the fence root
  // from where relative paths actually resolve.
  const session = new ShellSession({
    shellPath: config.shellPath,
    commandTimeoutMs: limits.commandTimeoutMs,
    maxOutputBytes: limits.maxOutputBytes,
    logger: message => warn(ctx, message),
  })
  const sandbox = new ExecSandbox(ctx)

  applyBashTool(ctx, {
    session,
    sandbox,
    limits,
    fence: {
      mode: config.fenceMode,
      commandPolicy: config.commandPolicy,
      allowCommands: nameSet(config.allowCommands, 'allowCommands'),
      denyCommands: nameSet(config.denyCommands, 'denyCommands'),
      toyboxApplets: nameSet(config.toyboxApplets, 'toyboxApplets'),
    },
  })

  // Best-effort teardown: the platform hides child exit, so disposal drops the
  // reference and never blocks process shutdown (plan §2 / §5.4).
  ctx.on('dispose', () => {
    session.dispose()
  })
}
