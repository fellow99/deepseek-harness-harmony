/**
 * Sandbox-escalation and session-resolution API shared by the `delete` and
 * `move` tools. The vocabulary, the strictly-wider ladder, and the fail-closed
 * approval sequence belong to `@deepseek-ai/dsh-sandbox`; this module only
 * adapts them to these two tools, mirroring `@deepseek-ai/dsh-tool-fs`'s
 * `FsSandboxController` so every filesystem family escalates identically.
 * @module harmony-plugin-fs-mutate/sandbox
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  canonicalPath,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox'

/** A path segment that traverses to a parent, in either separator dialect. */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The calling agent's per-session workspace cwd, or `undefined` for an
 * agent-less call (the backend then applies its own default).
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the session cwd, canonicalized only on that traversal case.
 */
function sessionCwd(exec, requestedPath) {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options for one `ctx.fs.resolve` call. An approved escalation's
 * workspace root wins over the session cwd, so an escalated mutation resolves
 * against the same root the backend will fence it by.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - the resolved per-call root, when a mutation carries a sandbox policy.
 * @returns provider resolution options for the current call.
 */
export function sessionResolveOptions(exec, requestedPath, policyWorkspaceRoot) {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  }
}

/**
 * The escalation API for the two mutating tools: advertisement gating,
 * per-call policy resolution, the one-approved wider retry, and denial-marker
 * mapping. Built once per plugin from `ctx.fs.sandboxMode`, which is the
 * capability fact answering "is a confining backend mounted?".
 */
export class FsMutationSandbox {
  /**
   * @param ctx - the plugin context; `ctx.fs` decides whether escalation is
   *   advertised and `ctx.sandboxPolicy` supplies the standing mode.
   */
  constructor(ctx) {
    this.ctx = ctx
    const defaultMode = ctx.fs.sandboxMode
    // The targets are the closed vocabulary, not "what is wider than the
    // deployment default": a session switched below that default would
    // otherwise be confined with no advertised lever. Strict widening is
    // checked per call, where the effective mode is known.
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    // `ctx.get` rather than the property proxy: this plugin does not inject
    // `sandboxPolicy`, and the proxy is topology-sensitive.
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('harmony-plugin-fs-mutate: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation parameter specs, or `{}` when no confining backend is
   * mounted — an unsandboxed composition must reject the fields at validation
   * rather than accept an ask that has nothing to escalate.
   * @returns the two parameter specs to spread into a tool's `parameters`.
   */
  escalationFields() {
    if (this.escalationModes.length === 0) return {}
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: 'The wider sandbox mode this file operation needs. Only valid as a one-shot retry '
          + 'of an operation the sandbox just denied; requires justification and user approval.',
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining '
          + 'why this exact file operation needs the wider access.',
      },
    }
  }

  /**
   * The policy to stamp onto every mutation this call performs: an approved
   * escalation grant (a strictly wider mode resolved through the approval
   * channel BEFORE anything executes), else the session's standing mode. The
   * escalation argument pairing is validated first, so a malformed ask never
   * reaches the user.
   * @param toolName - the calling tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context (agent, callId, signal).
   * @returns the policy to pass to each mutation, or `undefined` for an unsandboxed backend.
   */
  async resolvePolicy(toolName, args, exec) {
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    const standingPolicy = this.policy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
    if (args.sandbox_permissions === undefined || args.justification === undefined) return standingPolicy
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    // The escalation fields are schema-advertised only under a confining
    // backend, which always resolves a standing policy.
    const approvedMode = await approveEscalation(
      {
        requestedMode: args.sandbox_permissions,
        justification: args.justification,
        effectiveMode: standingPolicy.mode,
        subject: 'operation',
      },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
      },
    )
    return { ...standingPolicy, mode: approvedMode }
  }

  /**
   * Map a thrown provider error for the model. A `FS_SANDBOX_DENIED` becomes an
   * `FsError` whose text is the shared `[sandbox: …]` denial marker plus the
   * same-turn escalation hint, so the model can retry with the fields the tools
   * advertise; the structured code is preserved because `ToolRuntime`
   * populates `result.error` only for `HarnessError` instances. Any other error
   * passes through unchanged.
   * @param error - the error thrown by a mutation.
   * @param policy - the policy stamped onto the call; names the mode in the marker.
   * @returns the marker `FsError` for a sandbox denial, else the original error.
   */
  mapError(error, policy) {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    return new FsError(
      `${sandboxDenialMarker(policy.mode)}\n${escalationHintMarker('operation')}`,
      'FS_SANDBOX_DENIED',
      { cause: error },
    )
  }
}
