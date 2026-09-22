/**
 * The long-lived, non-PTY resident shell session for the `bash` tool.
 *
 * One `/system/bin/sh` child (configurable `shellPath`) is spawned lazily and
 * reused for every call; commands are serialized and completion is read ONLY
 * from the sentinel line on stdout, because on this platform the child's
 * `proc:exit` / `proc:close` never fire and every spawn leaks one zombie
 * (`[设备实测]`, spec FR-1.1/FR-1.2/FR-6.3). The `child_process.exec` /
 * `execFile` APIs are never used (they never call back, FR-1.3), the Electron
 * executable-path property is never a spawn target (its path is ENOENT), and
 * executability is never probed with a synchronous stat (EACCES false
 * negative, FR-6.5).
 *
 * The `spawn` function is an injected seam so every device-dependent path can
 * be driven by a fake in `node:test`; the default is the real
 * `node:child_process.spawn`.
 * @module harmony-plugin-exec/session
 */

import { spawn } from 'node:child_process'
import { createParser, frame, generateToken } from './protocol.js'

/** Default grace period for draining to the sentinel after the main timeout. */
const DEFAULT_DRAIN_MS_FACTOR = 1

/**
 * A single resident shell shared by every `bash` call of one plugin instance.
 *
 * Lifecycle: `IDLE -> WAITING -> IDLE`, with a timeout/cancel path through
 * `DRAINING` (still reading to the sentinel so the next command cannot be
 * confused by this command's tail) and a last-resort `reset()` that kills and
 * re-spawns the child. A reset leaks exactly one zombie, so it happens only
 * when stdout has closed or the drain itself times out (spec FR-5.2/FR-6.3).
 */
export class ShellSession {
  /**
   * @param {{
   *   shellPath: string,
   *   cwd?: string,
   *   commandTimeoutMs: number,
   *   drainTimeoutMs?: number,
   *   maxOutputBytes: number,
   *   spawn?: typeof spawn,
   *   logger?: (message: string) => void,
   * }} options - resolved plugin configuration plus the injectable spawn seam.
   */
  constructor(options) {
    this.shellPath = options.shellPath
    this.cwd = options.cwd
    this.commandTimeoutMs = options.commandTimeoutMs
    this.drainTimeoutMs = options.drainTimeoutMs
      ?? Math.max(1, options.commandTimeoutMs * DEFAULT_DRAIN_MS_FACTOR)
    this.maxOutputBytes = options.maxOutputBytes
    this.spawn = options.spawn ?? spawn
    this.logger = options.logger ?? (() => {})
    this.child = undefined
    this.alive = false
    this.current = undefined
    this.queue = []
    this.pumping = false
    this.disposed = false
    this.spawns = 0
    this.resets = 0
  }

  /** Spawn/reset accounting, for diagnostics and tests. */
  stats() {
    return { spawns: this.spawns, resets: this.resets, alive: this.alive }
  }

  /**
   * Run one command, queued behind any in-flight command (FR-5.6). Resolves
   * with a result object; rejects only on a session/infrastructure failure
   * (spawn failure or disposal), never for a non-zero exit code (FR-2.5).
   * @param {string} command - the shell command string.
   * @param {{ timeoutMs?: number, signal?: AbortSignal, cwd?: string }} [options]
   * @returns {Promise<{ output: Buffer, keptBytes: number, totalBytes: number, truncated: boolean, exitCode: number | null, timedOut: boolean, cancelled: boolean, reset: boolean, timeoutMs: number }>}
   */
  run(command, options = {}) {
    // The resident shell's cwd is fixed at first spawn; a later reset restores
    // it (FR-6.3/FR-6.6). Because `cd` persists, later calls ignore their cwd.
    if (this.cwd === undefined && typeof options.cwd === 'string' && options.cwd.length > 0) {
      this.cwd = options.cwd
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ command, options, resolve, reject })
      this.pump()
    })
  }

  /** Drain the queue serially; exactly one command is ever in flight. */
  pump() {
    if (this.pumping) return
    this.pumping = true
    const loop = async () => {
      while (this.queue.length > 0) {
        const job = this.queue.shift()
        if (job === undefined) break
        try {
          job.resolve(await this.executeOne(job.command, job.options))
        } catch (error) {
          job.reject(error)
        }
      }
    }
    loop()
      .catch((error) => {
        this.logger(`harmony-plugin-exec: shell queue failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        this.pumping = false
        if (this.queue.length > 0) this.pump()
      })
  }

  /** Return a live child, spawning one on first use (FR-6.1). */
  ensure() {
    if (this.disposed) throw new Error('harmony-plugin-exec: the shell session has been disposed')
    if (this.child !== undefined && this.alive) return this.child
    if (this.child !== undefined) {
      this.child = undefined
      this.alive = false
    }
    return this.spawnChild()
  }

  /** Spawn the resident shell and wire the streams; failure is loud (FR-6.1). */
  spawnChild() {
    this.spawns += 1
    let child
    try {
      child = this.spawn(this.shellPath, [], {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      })
    } catch (error) {
      throw new Error(`harmony-plugin-exec: failed to spawn shell ${this.shellPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.child = child
    this.alive = true
    // Every listener is scoped to THIS child object. Once a reset (or a stream
    // error) drops `this.child`, the stale child's late stdout events must not
    // settle the live command, so each handler early-returns unless the child
    // that emitted is still the active one (regression: stale-child listeners).
    child.stdout.on('data', chunk => { if (child !== this.child) return; this.handleStdout(chunk) })
    // stdout closing is the only observable liveness signal (FR-6.2). The
    // child's own 'exit'/'close' never fire, so they are deliberately unused.
    child.stdout.on('end', () => { if (child !== this.child) return; this.handleStdoutEnd() })
    child.stdout.on('error', error => { if (child !== this.child) return; this.handleStreamError(error) })
    // The separate stderr pipe carries shell diagnostics only, never protocol
    // bytes (FR-1.6); it is logged and otherwise ignored.
    child.stderr.on('data', chunk => {
      if (child !== this.child) return
      this.logger(`harmony-plugin-exec: shell stderr: ${String(chunk).trimEnd()}`)
    })
    child.stderr.on('error', error => { if (child !== this.child) return; this.handleStreamError(error) })
    if (typeof child.stdin.on === 'function') child.stdin.on('error', error => { if (child !== this.child) return; this.handleStreamError(error) })
    if (typeof child.on === 'function') child.on('error', error => { if (child !== this.child) return; this.handleStreamError(error) })
    return child
  }

  /**
   * Drop every listener this module attached to a child, so a child that is
   * being abandoned can never emit into the live session again (best-effort:
   * a stream object need not implement `removeAllListeners`).
   */
  detachChild(child) {
    if (child === undefined || child === null) return
    for (const stream of [child.stdout, child.stderr, child.stdin, child]) {
      if (stream !== undefined && stream !== null && typeof stream.removeAllListeners === 'function') {
        try {
          stream.removeAllListeners()
        } catch (error) {
          this.logger(`harmony-plugin-exec: detaching a dead child failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  /** One queued command: fence is already passed by the caller. */
  executeOne(command, options) {
    const child = this.ensure()
    const token = generateToken()
    const parser = createParser(token, { captureLimit: this.maxOutputBytes })
    const requested = options.timeoutMs
    const timeoutMs = Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, this.commandTimeoutMs)
      : this.commandTimeoutMs

    return new Promise((resolve, reject) => {
      const state = {
        command,
        parser,
        resolve,
        reject,
        settled: false,
        draining: false,
        timedOut: false,
        cancelled: false,
        reset: false,
        timeoutMs,
        signal: options.signal,
        mainTimer: undefined,
        drainTimer: undefined,
        onAbort: undefined,
      }
      this.current = state

      if (options.signal !== undefined) {
        state.onAbort = () => this.beginDrain(state, 'cancelled')
        if (options.signal.aborted) {
          this.beginDrain(state, 'cancelled')
          return
        }
        options.signal.addEventListener('abort', state.onAbort, { once: true })
      }

      state.mainTimer = setTimeout(() => this.beginDrain(state, 'timeout'), timeoutMs)
      if (typeof state.mainTimer.unref === 'function') state.mainTimer.unref()

      try {
        child.stdin.write(frame(token, command))
      } catch (error) {
        this.fail(state, error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Enter DRAINING: keep reading to the sentinel, reset only if it never comes. */
  beginDrain(state, cause) {
    if (state.settled || state.draining) return
    state.draining = true
    if (cause === 'timeout') state.timedOut = true
    if (cause === 'cancelled') state.cancelled = true
    if (state.mainTimer !== undefined) clearTimeout(state.mainTimer)
    state.drainTimer = setTimeout(() => this.resetAfterDrain(state), this.drainTimeoutMs)
    if (typeof state.drainTimer.unref === 'function') state.drainTimer.unref()
  }

  /** The drain itself timed out: the session cannot resync, so reset it. */
  resetAfterDrain(state) {
    if (state.settled) return
    this.reset('drain timeout')
    state.reset = true
    const snapshot = state.parser.snapshot()
    this.complete(state, { output: snapshot.output, exitCode: null, totalBytes: snapshot.totalBytes })
  }

  /** Feed stdout bytes to the active parser; a match completes the command. */
  handleStdout(chunk) {
    const state = this.current
    if (state === undefined || state.settled) return
    const parsed = state.parser.push(chunk)
    if (parsed === undefined) return
    this.complete(state, parsed)
  }

  /** stdout ended: the resident shell is gone; fail the call and mark it dead. */
  handleStdoutEnd() {
    this.alive = false
    this.child = undefined
    const state = this.current
    if (state === undefined || state.settled) return
    const snapshot = state.parser.snapshot()
    state.reset = true
    this.complete(state, { output: snapshot.output, exitCode: null, totalBytes: snapshot.totalBytes })
  }

  /** A stream error means the session is unusable; the next call re-spawns. */
  handleStreamError(error) {
    this.alive = false
    // Kill + detach + drop the failing child: leaving it referenced (and
    // running) would let it keep emitting into the next command's state.
    const child = this.child
    this.detachChild(child)
    if (child !== undefined) {
      try {
        child.kill('SIGKILL')
      } catch (killError) {
        this.logger(`harmony-plugin-exec: kill after a stream error failed: ${killError instanceof Error ? killError.message : String(killError)}`)
      }
    }
    this.child = undefined
    const state = this.current
    if (state !== undefined && !state.settled) {
      this.fail(state, new Error(`harmony-plugin-exec: shell stream failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  /** Settle a command successfully with its captured bytes and exit code. */
  complete(state, parsed) {
    if (state.settled) return
    state.settled = true
    this.current = undefined
    this.cleanup(state)
    const output = parsed.output
    const totalBytes = parsed.totalBytes
    state.resolve({
      output,
      keptBytes: output.length,
      totalBytes,
      truncated: totalBytes > output.length,
      exitCode: parsed.exitCode,
      timedOut: state.timedOut,
      cancelled: state.cancelled,
      reset: state.reset,
      timeoutMs: state.timeoutMs,
    })
  }

  /** Reject the in-flight command for an infrastructure failure. */
  fail(state, error) {
    if (state.settled) return
    state.settled = true
    this.current = undefined
    this.cleanup(state)
    state.reject(error)
  }

  /** Clear timers and the abort listener for a settled command. */
  cleanup(state) {
    if (state.mainTimer !== undefined) clearTimeout(state.mainTimer)
    if (state.drainTimer !== undefined) clearTimeout(state.drainTimer)
    if (state.onAbort !== undefined && state.signal !== undefined) {
      state.signal.removeEventListener('abort', state.onAbort)
    }
  }

  /** Kill the current child and force the next call to spawn a fresh one. */
  reset(reason) {
    this.resets += 1
    const child = this.child
    // Detach first so no in-flight event from the dying child can touch the
    // next command; then kill, then drop the reference.
    this.detachChild(child)
    if (child !== undefined) {
      try {
        child.kill('SIGKILL')
      } catch (error) {
        // The platform hides process exit, so a kill failure is not observable
        // here; it is logged and the reference is dropped regardless.
        this.logger(`harmony-plugin-exec: kill during reset failed (${reason}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.child = undefined
    this.alive = false
  }

  /** Best-effort teardown: reject any in-flight/queued work and drop the child. */
  dispose() {
    this.disposed = true
    const state = this.current
    if (state !== undefined && !state.settled) {
      this.fail(state, new Error('harmony-plugin-exec: the shell session was disposed'))
    }
    if (this.child !== undefined) {
      try {
        this.child.kill('SIGKILL')
      } catch (error) {
        this.logger(`harmony-plugin-exec: kill during dispose failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.child = undefined
    this.alive = false
    while (this.queue.length > 0) {
      const job = this.queue.shift()
      if (job !== undefined) job.reject(new Error('harmony-plugin-exec: the shell session was disposed'))
    }
  }
}
