/**
 * Token-level path fence and command policy for the `bash` tool.
 *
 * Deliberately import-free so `node:test` drives the whole decision engine on
 * bare Node. It is a BEST-EFFORT, tool-layer check, NOT a sandbox: it runs
 * before dispatch on the command STRING only, so variable expansion, command
 * substitution, a nested shell, or a tool that reads a path from a config file
 * can all move a real path out of sight (spec §6.4). Its job is to raise the
 * cost and visibility of an out-of-root literal path, not to guarantee
 * confinement (spec FR-3.2..FR-3.8).
 * @module harmony-plugin-exec/fence
 */

/**
 * Operational default of system/hardware control verbs refused even under
 * `disclose-only`, because they have no normal model use and fail noisily
 * (spec FR-4.5). Configurable: a caller passes its own set to override.
 */
export const DEFAULT_DENY_COMMANDS = Object.freeze([
  'reboot', 'reset', 'mount', 'umount', 'swapon', 'swapoff', 'mkswap',
  'insmod', 'rmmod', 'modinfo', 'devmem', 'i2cdetect', 'i2cdump', 'i2cget',
  'i2cset', 'i2ctransfer', 'chroot', 'pivot_root', 'switch_root', 'nsenter',
  'unshare',
])

const EMPTY_SET = new Set()

/** Characters that form a shell operator token outside quotes. */
const OPERATOR_CHARS = new Set(['>', '<', '|', '&', ';', '(', ')'])

/**
 * Split a command string with POSIX-shell quote rules. Single quotes are
 * literal; inside double quotes a backslash escapes the next character; outside
 * quotes a backslash escapes the next character. Variables are NOT expanded and
 * globs are NOT applied — the tokens are kept as written (plan §6.2 step 1).
 * Each token records whether it contains a `$` or backtick OUTSIDE single
 * quotes, which is what makes it an unanalyzable path-hiding construct.
 * @param {string} command - the raw command string.
 * @returns {Array<{ kind: 'word' | 'operator', value: string, expandable: boolean }>}
 */
export function tokenize(command) {
  const tokens = []
  if (typeof command !== 'string') return tokens
  let word = ''
  let hasWord = false
  let expandable = false
  let index = 0

  const flush = () => {
    if (hasWord) tokens.push({ kind: 'word', value: word, expandable })
    word = ''
    hasWord = false
    expandable = false
  }

  while (index < command.length) {
    const char = command[index]
    if (char === "'") {
      hasWord = true
      index++
      while (index < command.length && command[index] !== "'") {
        word += command[index]
        index++
      }
      index++ // consume the closing quote (or run off the end on an unbalanced one)
      continue
    }
    if (char === '"') {
      hasWord = true
      index++
      while (index < command.length && command[index] !== '"') {
        if (command[index] === '\\' && index + 1 < command.length) {
          word += command[index + 1]
          index += 2
          continue
        }
        if (command[index] === '$' || command[index] === '`') expandable = true
        word += command[index]
        index++
      }
      index++
      continue
    }
    if (char === '\\' && index + 1 < command.length) {
      hasWord = true
      word += command[index + 1]
      index += 2
      continue
    }
    if (char === '$' || char === '`') {
      hasWord = true
      expandable = true
      word += char
      index++
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      flush()
      index++
      continue
    }
    if (OPERATOR_CHARS.has(char)) {
      flush()
      let operator = ''
      while (index < command.length && OPERATOR_CHARS.has(command[index])) {
        operator += command[index]
        index++
      }
      tokens.push({ kind: 'operator', value: operator, expandable: false })
      continue
    }
    hasWord = true
    word += char
    index++
  }
  flush()
  return tokens
}

/**
 * Extract the path-candidate tokens the fence judges (spec FR-3.2): a word
 * containing `/`, a word starting with `.` or `~`, and the target word after a
 * redirection operator (spec FR-3.5 — redirect targets are fenced too).
 * @param {Array<{ kind: string, value: string }>} tokens - tokens from {@link tokenize}.
 * @returns {Array<{ value: string, viaRedirect: boolean }>}
 */
export function extractPathTokens(tokens) {
  const candidates = []
  let redirectPending = false
  for (const token of tokens) {
    if (token.kind === 'operator') {
      redirectPending = token.value.includes('>') || token.value.includes('<')
      continue
    }
    if (redirectPending) {
      candidates.push({ value: token.value, viaRedirect: true })
      redirectPending = false
      continue
    }
    if (token.value.includes('/') || token.value.startsWith('.') || token.value.startsWith('~')) {
      candidates.push({ value: token.value, viaRedirect: false })
    }
  }
  return candidates
}

/**
 * Resolve a path token to a normalized absolute path using the session cwd.
 * Purely lexical — it never touches the filesystem and never resolves
 * symlinks (spec FR-3.2 step 3). A `~` token returns `null` because the home
 * directory is unknowable statically; the caller treats that as unanalyzable
 * (fail-closed).
 * @param {string} value - the raw token.
 * @param {string} cwd - the session workspace used as the resolution base.
 * @returns {string | null} the normalized absolute path, or null when unresolvable.
 */
export function normalizePath(value, cwd) {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.startsWith('~')) return null
  const absolute = value.startsWith('/')
    ? value
    : (typeof cwd === 'string' && cwd.length > 0
      ? (cwd.endsWith('/') ? cwd + value : cwd + '/' + value)
      : null)
  if (absolute === null) return null
  return normalizeLexical(absolute)
}

/** Collapse `.`/`..`/duplicate separators without touching the filesystem. */
function normalizeLexical(path) {
  const absolute = path.startsWith('/')
  const stack = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }
  return `${absolute ? '/' : ''}${stack.join('/')}`
}

/**
 * Test whether a normalized path lies inside one of the allowed roots. The
 * boundary is separator-aware, so `/a/bc` is NOT inside `/a/b` (spec FR-3.2
 * step 4 / TC-U4).
 * @param {string} resolved - a path from {@link normalizePath}.
 * @param {readonly string[]} roots - absolute allowed roots.
 * @returns {boolean}
 */
export function isWithinRoots(resolved, roots) {
  for (const root of roots) {
    const normalized = normalizeLexical(root)
    if (resolved === normalized) return true
    if (normalized === '/') return resolved.startsWith('/')
    if (resolved.startsWith(`${normalized}/`)) return true
  }
  return false
}

/** The last path segment, so `/system/bin/sh` and `sh` compare equal. */
function baseName(value) {
  const parts = value.split('/')
  return parts[parts.length - 1]
}

/** The first non-assignment word — the command name in command position. */
function firstCommandWord(words) {
  for (const word of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.value)) continue
    return word
  }
  return undefined
}

/** Shell separators that open a new command position. */
const SEGMENT_CHARS = new Set([';', '|', '&', '(', ')'])

/**
 * Split the token stream into command segments at the shell separators
 * (`;`, `|`, `&&`, `||`, `&`, `(`, `)`), keeping each segment's word tokens.
 * Every command position must be judged, not just the first: `ls; reboot` and
 * `ls | xargs rm` are otherwise trivially allowed (spec FR-3.4 / FR-4.5).
 * Redirection operators (`>`, `<`, `>>`) do NOT split a segment.
 * @param {Array<{ kind: string, value: string }>} tokens - tokens from {@link tokenize}.
 * @returns {Array<Array<{ kind: string, value: string, expandable: boolean }>>}
 */
function commandSegments(tokens) {
  const segments = []
  let current = []
  for (const token of tokens) {
    if (token.kind === 'operator' && [...token.value].every(char => SEGMENT_CHARS.has(char))) {
      if (current.length > 0) segments.push(current)
      current = []
      continue
    }
    if (token.kind === 'word') current.push(token)
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/**
 * Detect constructs that hide a path from static analysis (spec FR-3.4):
 * `$`/backtick anywhere outside single quotes, `eval`/`env`/`xargs` in ANY
 * command position, a nested `sh -c`/`bash -c`, and `find … -exec`/`-execdir`.
 * @param {Array} words - every word token (for the global expansion check).
 * @param {Array<Array>} segments - command segments from {@link commandSegments}.
 * @returns {string | null} the reason, or null when nothing is hidden.
 */
function scanUnanalyzable(words, segments) {
  for (const token of words) {
    if (token.expandable) {
      return 'a variable expansion, command substitution, or backtick can hide a path'
    }
  }
  for (const segment of segments) {
    const command = firstCommandWord(segment)
    if (command === undefined) continue
    const name = baseName(command.value)
    if (name === 'eval' || name === 'env' || name === 'xargs') {
      return `\`${name}\` can hide a path from static analysis`
    }
    // A glued form such as `sh -c'…'` tokenizes as a single `-c…` word.
    if ((name === 'sh' || name === 'bash') && segment.some(word => /^-c/.test(word.value))) {
      return `a nested \`${name} -c\` runs a hidden command string`
    }
    if (name === 'find' && segment.some(word => word.value === '-exec' || word.value === '-execdir')) {
      return '`find -exec` runs a hidden command'
    }
  }
  return null
}

/**
 * Judge one command before dispatch (plan §6.2).
 *
 * Precedence is fail-closed: any literal out-of-root path, any unanalyzable
 * construct, or any command-policy violation yields `deny`/`unanalyzable`.
 * `fenceMode: 'off'` skips analysis; `fenceMode: 'warn'` reports the same
 * verdict as `skipped` (allow, but visibly downgraded) — both are explicit
 * security downgrades (spec FR-3.7 / §6.5).
 *
 * This function does NOT invoke approval. A caller that receives a denial must
 * run the fence FIRST and only then offer the one-shot escalation (spec
 * FR-3.1 / §6.2).
 *
 * @param {{
 *   command: string,
 *   cwd?: string,
 *   roots?: readonly string[],
 *   mode?: 'enforce' | 'warn' | 'off',
 *   commandPolicy?: 'disclose-only' | 'allowlist' | 'denylist',
 *   allowCommands?: ReadonlySet<string>,
 *   denyCommands?: ReadonlySet<string>,
 *   toyboxApplets?: ReadonlySet<string>,
 * }} options - the command and the deployment's fence configuration.
 * @returns {{ decision: 'allow' | 'deny' | 'unanalyzable' | 'skipped', verdict: string, reason: string, offenders: Array<{ token: string, resolved: string | null }> }}
 */
export function check(options) {
  const mode = options.mode ?? 'enforce'
  if (mode === 'off') {
    return { decision: 'skipped', verdict: 'skipped', reason: 'fenceMode=off: no path analysis was performed', offenders: [] }
  }
  const command = options.command
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { decision: 'allow', verdict: 'allow', reason: 'empty command', offenders: [] }
  }

  const cwd = options.cwd
  const roots = options.roots ?? []
  const commandPolicy = options.commandPolicy ?? 'disclose-only'
  const allowCommands = options.allowCommands ?? EMPTY_SET
  const denyCommands = options.denyCommands ?? new Set(DEFAULT_DENY_COMMANDS)
  const toyboxApplets = options.toyboxApplets ?? EMPTY_SET

  let verdict = 'allow'
  let reason = ''
  const offenders = []

  const tokens = tokenize(command)
  const words = tokens.filter(token => token.kind === 'word')
  const segments = commandSegments(tokens)

  for (const candidate of extractPathTokens(tokens)) {
    const resolved = normalizePath(candidate.value, cwd)
    if (resolved === null) {
      if (verdict === 'allow') verdict = 'unanalyzable'
      if (reason.length === 0) reason = `cannot resolve path token ${JSON.stringify(candidate.value)} without filesystem access`
      offenders.push({ token: candidate.value, resolved: null })
      continue
    }
    if (!isWithinRoots(resolved, roots)) {
      if (verdict === 'allow') verdict = 'deny'
      if (reason.length === 0) reason = `path ${JSON.stringify(resolved)} is outside the allowed roots`
      offenders.push({ token: candidate.value, resolved })
    }
  }

  const unanalyzable = scanUnanalyzable(words, segments)
  if (unanalyzable !== null) {
    if (verdict === 'allow') verdict = 'unanalyzable'
    if (reason.length === 0) reason = unanalyzable
    offenders.push({ token: unanalyzable, resolved: null })
  }

  // The deny list is checked at EVERY command position, not just the first, so
  // `ls; reboot` / `ls | reboot` cannot smuggle a denied verb past it (FR-4.5).
  for (const segment of segments) {
    const commandWord = firstCommandWord(segment)
    if (commandWord === undefined) continue
    const commandIndex = segment.indexOf(commandWord)
    const name = baseName(commandWord.value)
    const appletWord = name === 'toybox' ? segment[commandIndex + 1] : undefined
    const appletName = appletWord === undefined ? undefined : baseName(appletWord.value)

    if (denyCommands.has(name)) {
      verdict = 'deny'
      if (reason.length === 0) reason = `command \`${name}\` is on the default deny list`
      offenders.push({ token: name, resolved: null })
    }
    if (appletName !== undefined && denyCommands.has(appletName)) {
      verdict = 'deny'
      if (reason.length === 0) reason = `toybox applet \`${appletName}\` is on the default deny list`
      offenders.push({ token: appletName, resolved: null })
    }
  }

  // The allowlist is a property of the first command position: a later
  // segment still has to satisfy the deny list and the unanalyzable scan.
  const commandWord = firstCommandWord(segments[0] ?? [])
  if (commandWord !== undefined) {
    const commandIndex = segments[0].indexOf(commandWord)
    const name = baseName(commandWord.value)
    const appletWord = name === 'toybox' ? segments[0][commandIndex + 1] : undefined
    const appletName = appletWord === undefined ? undefined : baseName(appletWord.value)

    if (commandPolicy === 'allowlist') {
      if (name === 'toybox') {
        // FR-4.4: `toybox <any-applet>` would otherwise bypass the allowlist.
        if (appletName === undefined || !toyboxApplets.has(appletName)) {
          verdict = 'deny'
          if (reason.length === 0) {
            reason = `toybox passthrough ${appletName === undefined ? '(missing applet)' : `\`${appletName}\``} is not in the B-class applet whitelist`
          }
          offenders.push({ token: appletName ?? 'toybox', resolved: null })
        }
      } else if (!allowCommands.has(name)) {
        verdict = 'deny'
        if (reason.length === 0) reason = `command \`${name}\` is not in the allowlist`
        offenders.push({ token: name, resolved: null })
      }
    }
  }

  if (mode === 'warn' && verdict !== 'allow') {
    return { decision: 'skipped', verdict, reason: `fenceMode=warn (explicit downgrade): ${reason}`, offenders }
  }
  return { decision: verdict, verdict, reason, offenders }
}
