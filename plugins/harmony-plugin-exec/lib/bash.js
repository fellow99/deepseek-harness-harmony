/**
 * The model-facing `bash` tool: register the schema, run the tool-layer path
 * fence BEFORE any approval interaction, then dispatch to the resident-shell
 * session and render `Exit code:` plus output.
 *
 * The honest framing (spec §6): this tool executes with the application's own
 * uid, so the fence raises cost and visibility but is not a sandbox. The tool
 * name stays `bash` for continuity with the upstream identity (spec FR-2.1).
 * @module harmony-plugin-exec/bash
 */

import { delimiter } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox'
import { check } from './fence.js'
import { buildToolDescription } from './inventory.js'

/**
 * Escalation adapter for the exec tool, mirroring
 * `harmony-plugin-fs-mutate/lib/sandbox.js` so every family escalates
 * identically. Built once per plugin from `ctx.fs.sandboxMode`, the capability
 * fact answering "is a confining backend mounted?".
 *
 * Note the residual gap (spec §6.4): the shell bypasses the filesystem fence
 * entirely, so a granted mode does not actually confine the child — the
 * approval path is preserved for vocabulary/ordering fidelity, but the fence is
 * the only real lever this tool has.
 */
export class ExecSandbox {
  /** @param ctx - the plugin context; `ctx.fs.sandboxMode` gates advertisement. */
  constructor(ctx) {
    this.ctx = ctx
    const defaultMode = ctx.fs.sandboxMode
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('harmony-plugin-exec: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation parameter specs, or `{}` when no confining backend is
   * mounted — an unsandboxed composition rejects the fields at validation
   * rather than accepting an ask with nothing to escalate (spec FR-2.2).
   * @returns the two parameter specs to spread into the tool's `parameters`.
   */
  escalationFields() {
    if (this.escalationModes.length === 0) return {}
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command '
          + 'the fence just denied; requires justification and user approval.',
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact '
          + 'command needs the wider access.',
      },
    }
  }

  /** The standing mode for a call, or undefined when nothing confines. */
  standingMode(exec) {
    const standing = this.policy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
    return standing?.mode
  }

  /**
   * Resolve one escalation through the shared fail-closed sequence. Called
   * ONLY after the fence has denied the command (spec FR-3.1).
   * @param toolName - the calling tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context.
   * @returns the approved policy to stamp onto this call.
   */
  async approve(toolName, args, exec) {
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    const standing = this.policy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
    const approvedMode = await approveEscalation(
      {
        requestedMode: args.sandbox_permissions,
        justification: args.justification,
        effectiveMode: standing.mode,
        subject: 'command',
      },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
      },
    )
    return { ...standing, mode: approvedMode }
  }
}

/** Validate the model arguments before any fence or execution (spec FR-1.8). */
function validateArgs(args, limits) {
  if (typeof args.command !== 'string' || args.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (args.command.length > limits.maxCommandChars) {
    throw new Error(`invalid command: exceeds maxCommandChars (${limits.maxCommandChars})`)
  }
  if (args.timeout_ms !== undefined && (!Number.isSafeInteger(args.timeout_ms) || args.timeout_ms < 1)) {
    throw new Error(`invalid timeout_ms: expected a positive integer, got ${JSON.stringify(args.timeout_ms)}`)
  }
  validateEscalationArgs(args.sandbox_permissions, args.justification)
}

/**
 * The allowed roots for one call: the session cwd plus the deployment-time
 * `DSH_EXTRA_WRITABLE_ROOTS` (spec FR-3.3 / `src-main/main.js:600-630`).
 */
function allowedRoots(cwd) {
  const roots = []
  if (typeof cwd === 'string' && cwd.length > 0) roots.push(cwd)
  const extra = process.env.DSH_EXTRA_WRITABLE_ROOTS
  if (typeof extra === 'string' && extra.length > 0) {
    for (const entry of extra.split(delimiter)) {
      if (entry.length > 0) roots.push(entry)
    }
  }
  return roots
}

/** The shared denial marker plus the fence reason, and the hint when available. */
function denialText(verdict, sandbox, exec) {
  const lines = []
  const mode = sandbox.standingMode(exec)
  if (mode !== undefined) lines.push(sandboxDenialMarker(mode))
  lines.push(`command blocked by the path fence: ${verdict.reason}`)
  if (sandbox.escalationModes.length > 0) lines.push(escalationHintMarker('command'))
  return lines.join('\n')
}

/** Render one session result as the model-facing text block (spec FR-2.3). */
function renderResult(result) {
  const exitCode = result.exitCode === null ? 'unknown' : String(result.exitCode)
  let text = `Exit code: ${exitCode}\n${result.output.toString('utf8')}`
  if (result.truncated) text += `\n[output truncated: kept ${result.keptBytes} of ${result.totalBytes} bytes]`
  if (result.cancelled) text += '\n[command cancelled]'
  if (result.timedOut) text += `\n[command timed out after ${result.timeoutMs}ms]`
  if (result.reset) text += '\n[session reset: the shell did not return to a known state]'
  return text
}

/**
 * Register the `bash` tool.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param {{
 *   session: import('./session.js').ShellSession,
 *   sandbox: ExecSandbox,
 *   limits: { commandTimeoutMs: number, maxCommandChars: number, maxOutputBytes: number },
 *   fence: {
 *     mode: string,
 *     commandPolicy: string,
 *     allowCommands: ReadonlySet<string>,
 *     denyCommands: ReadonlySet<string>,
 *     toyboxApplets: ReadonlySet<string>,
 *   },
 * }} options - the assembled session, escalation adapter, limits, and fence config.
 * @returns {void}
 */
export function applyBashTool(ctx, options) {
  const { session, sandbox, limits, fence } = options

  ctx.tools.register(defineTool({
    name: 'bash',
    description: buildToolDescription(limits),
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The command string to execute in the resident shell. Runs non-interactively with no TTY; '
          + '`cd` and shell variables persist across calls.',
      },
      timeout_ms: {
        type: 'integer',
        description: `Optional per-call timeout in milliseconds; only lowers the tool's ${limits.commandTimeoutMs} ms cap.`,
      },
      ...sandbox.escalationFields(),
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      validateArgs(args, limits)
      const cwd = exec.agent?.session.header.cwd
      const verdict = check({
        command: args.command,
        cwd,
        roots: allowedRoots(cwd),
        mode: fence.mode,
        commandPolicy: fence.commandPolicy,
        allowCommands: fence.allowCommands,
        denyCommands: fence.denyCommands,
        toyboxApplets: fence.toyboxApplets,
      })
      // Fail-closed ORDER (spec FR-3.1 / §6.2): the fence decides first; only a
      // denied command may reach the approval channel, and only on a retry that
      // carries escalation arguments. A denial with no escalation fields never
      // prompts the user.
      if (verdict.decision === 'deny' || verdict.decision === 'unanalyzable') {
        if (args.sandbox_permissions === undefined || args.justification === undefined) {
          throw new Error(denialText(verdict, sandbox, exec))
        }
        await sandbox.approve('bash', args, exec)
      }
      const result = await session.run(args.command, {
        timeoutMs: args.timeout_ms,
        signal: exec.signal,
        cwd,
      })
      return renderResult(result)
    },
  }))
}
