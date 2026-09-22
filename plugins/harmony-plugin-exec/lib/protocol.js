/**
 * Sentinel-line framing and byte-exact parsing for the resident-shell protocol.
 *
 * Deliberately import-free: the whole protocol engine runs on bare Node so
 * `node:test` can drive it without a device, a shell, or any dsh package — the
 * same strategy `harmony-plugin-fs-search`/`harmony-plugin-fs-mutate` use for
 * their engines. `Buffer`/`globalThis.crypto` are referenced as globals only,
 * never imported.
 *
 * The platform observation this protocol exists to survive (`[设备实测]`, spec
 * FR-1.2): a spawned child's `proc:exit` / `proc:close` never fires, so
 * completion cannot be read from lifecycle events. Instead the resident shell
 * prints a random-token BEGIN line before a command and a random-token END line
 * carrying `$?` after it; the parser treats the END line as the only completion
 * signal (spec FR-1.5).
 * @module harmony-plugin-exec/protocol
 */

/** Marker prefix of the line that opens a capture window (spec FR-1.5). */
export const BEGIN_MARKER = '__DSH_BASH_BEGIN__'

/** Marker prefix of the line that closes a capture window (spec FR-1.5). */
export const END_MARKER = '__DSH_BASH_END__'

const NEWLINE = 0x0a
const COMPACT_THRESHOLD = 8192

/**
 * Produce a fresh one-shot token. The default source is the global WebCrypto
 * RNG (16 hex chars = 8 random bytes); a caller may inject a byte source so a
 * test can pin the token. The command never learns the token, so output that
 * happens to look like a sentinel cannot close the window (spec FR-1.5).
 * @param {() => Uint8Array} [randomBytes] - 8-byte source; defaults to `globalThis.crypto`.
 * @returns {string} 16 lowercase hex characters.
 */
export function generateToken(randomBytes) {
  const bytes = randomBytes === undefined ? defaultRandomBytes() : randomBytes()
  let token = ''
  for (const byte of bytes) token += byte.toString(16).padStart(2, '0')
  return token
}

/** The default 8-byte source: the global WebCrypto RNG (no import). */
function defaultRandomBytes() {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Build the exact text written to the resident shell's stdin for one command
 * (spec FR-1.5 / plan §5.2). Each `printf` emits a leading newline so the
 * marker always starts a fresh line — command output that does not end in a
 * newline therefore cannot pollute the END marker.
 * @param {string} token - the one-shot token embedded in both markers.
 * @param {string} command - the command string, interpreted by the shell.
 * @returns {string} the framing, newline-terminated, exactly as the shell receives it.
 */
export function frame(token, command) {
  return `printf '\\n__DSH_BASH_BEGIN__ %s\\n' '${token}'\n`
    + `{ ${command}\n`
    + '} 2>&1\n'
    + '__dsh_rc=$?\n'
    + `printf '\\n__DSH_BASH_END__ %s %s\\n' '${token}' "$__dsh_rc"\n`
}

/**
 * Create an incremental parser for one command's stdout stream.
 *
 * The parser accepts arbitrary chunking (a caller may feed one byte at a time)
 * and returns `undefined` until the matching END line has fully arrived. It
 * looks one line ahead so it can distinguish the framing newline that precedes
 * the END marker from a newline the command itself produced: a newline belongs
 * to the command's output unless the next line is exactly the END line for this
 * token. Captured bytes are carried verbatim (spec FR-2.4) — never decoded to a
 * string before being handed back.
 *
 * @param {string} token - the same one-shot token passed to {@link frame}.
 * @param {{ captureLimit?: number }} [options] - optional inclusive byte cap:
 *   bytes past it are counted but not retained, so a huge output still drains
 *   to the sentinel and `totalBytes` reports the true size (spec FR-5.4).
 * @returns {{ push: (chunk: string | Uint8Array) => ({ output: Buffer | Uint8Array, exitCode: number, totalBytes: number, beganAt: number, endedAt: number } | undefined), snapshot: () => { output: Buffer | Uint8Array, totalBytes: number } }}
 */
export function createParser(token, options = {}) {
  const captureLimit = options.captureLimit
  const beginLine = `${BEGIN_MARKER} ${token}`
  const endPrefix = `${END_MARKER} ${token} `
  let pending = []
  let start = 0
  let consumed = 0
  let started = false
  let capture = []
  let totalBytes = 0
  let beganAt = -1

  const output = () => (typeof Buffer === 'undefined' ? Uint8Array.from(capture) : Buffer.from(capture))

  const findByte = (from, byte) => {
    for (let i = from; i < pending.length; i++) if (pending[i] === byte) return i
    return -1
  }

  const latin1 = (from, to) => {
    let text = ''
    for (let i = from; i < to; i++) text += String.fromCharCode(pending[i])
    return text
  }

  /** Advance the cursor, keeping the physical buffer bounded. */
  const advance = (to) => {
    consumed += to - start
    start = to
    if (start > COMPACT_THRESHOLD) {
      pending = pending.slice(start)
      start = 0
    }
  }

  return {
    /** The bytes captured so far, plus any partial line still in flight. */
    snapshot() {
      const captured = output()
      const partial = typeof Buffer === 'undefined'
        ? Uint8Array.from(pending.slice(start))
        : Buffer.from(pending.slice(start))
      const merged = typeof Buffer === 'undefined' ? concatBytes(captured, partial) : Buffer.concat([captured, partial])
      return { output: merged, totalBytes: totalBytes + (pending.length - start) }
    },

    push(chunk) {
      const bytes = typeof chunk === 'string' ? stringToBytes(chunk) : chunk
      for (let i = 0; i < bytes.length; i++) pending.push(bytes[i])

      while (true) {
        if (!started) {
          const nl = findByte(start, NEWLINE)
          if (nl === -1) break
          const line = latin1(start, nl)
          advance(nl + 1)
          if (line === beginLine) {
            started = true
            beganAt = consumed
            capture = []
            totalBytes = 0
          }
          // A non-BEGIN line before the window is pre-window noise; drop it.
          continue
        }
        // Inside the window a line closes it only when it is the exact END
        // line; the newline before the marker is then framing, not output.
        const nl = findByte(start, NEWLINE)
        if (nl === -1) break
        const nextNl = findByte(nl + 1, NEWLINE)
        if (nextNl === -1) break
        const exitCode = parseEndLine(latin1(nl + 1, nextNl), endPrefix)
        if (exitCode !== null) {
          totalBytes += nl - start
          appendWithinLimit(capture, pending, start, nl, captureLimit)
          const endedAt = consumed + (nextNl + 1 - start)
          const result = { output: output(), exitCode, totalBytes, beganAt, endedAt }
          advance(nextNl + 1)
          started = false
          return result
        }
        totalBytes += nl + 1 - start
        appendWithinLimit(capture, pending, start, nl + 1, captureLimit)
        advance(nl + 1)
      }
      return undefined
    },
  }
}

/** Append `[from, to)` to `capture` until `limit`; returns the number appended. */
function appendWithinLimit(capture, source, from, to, limit) {
  if (limit === undefined) {
    for (let i = from; i < to; i++) capture.push(source[i])
    return to - from
  }
  const room = limit - capture.length
  if (room <= 0) return 0
  const count = Math.min(room, to - from)
  for (let i = 0; i < count; i++) capture.push(source[from + i])
  return count
}

/**
 * Parse an END line for this token, returning its exit code or null.
 * The token must match exactly and the remainder must be a bounded decimal run
 * (a POSIX exit status is 0..255; 6 digits is already generous), so an
 * approximate string in command output cannot arm completion (spec FR-1.5) and
 * a huge digit run cannot produce a non-safe integer.
 */
const MAX_RC_DIGITS = 6

function parseEndLine(line, endPrefix) {
  if (!line.startsWith(endPrefix)) return null
  const rc = line.slice(endPrefix.length)
  if (rc.length === 0 || rc.length > MAX_RC_DIGITS) return null
  for (const char of rc) {
    if (char < '0' || char > '9') return null
  }
  return Number(rc)
}

/** Encode a convenience string chunk as UTF-8 bytes without an import. */
function stringToBytes(text) {
  if (typeof TextEncoder === 'undefined') {
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
    return bytes
  }
  return new TextEncoder().encode(text)
}

/** Concatenate two byte views for the no-Buffer fallback of {@link createParser}. */
function concatBytes(left, right) {
  const merged = new Uint8Array(left.length + right.length)
  merged.set(left, 0)
  merged.set(right, left.length)
  return merged
}
