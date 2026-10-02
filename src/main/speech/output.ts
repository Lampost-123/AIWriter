// Adapted from mcreader-v2, src/server/speech/install.ts (takeOutput: progress bars redraw with \r and the
// latest percentage wins) (Adam's rule, 2 October 2026: only speech code is reused).
//
// Reading what a download step prints: pip's "Progress <done> of <total>", the server's own install tool
// ("@@progress", "@@licence", "@@gpu", "@@error", see speech-server/tools/install.py), Windows' installer's
// bars, and plain lines worth showing as "the latest line". Then what went wrong, in plain words. Pure.

/** What one line of output says. */
export type OutputEvent =
  | { kind: 'bytes'; done: number; total: number }
  | { kind: 'percent'; percent: number }
  | { kind: 'file'; name: string }
  | { kind: 'licence'; url: string }
  | { kind: 'gpu'; name: string }
  | { kind: 'error'; message: string }
  | { kind: 'line'; text: string }

/** Splits output into lines as it arrives: a line can end in \n, \r\n or \r (a bar drawing over itself), and a chunk can end mid-line. */
export class LineSplitter {
  private rest = ''

  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split(/\r\n|\r|\n/)
    this.rest = parts.pop() ?? ''
    return parts
  }

  flush(): string[] {
    const last = this.rest
    this.rest = ''
    return last ? [last] : []
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g

export const stripAnsi = (s: string): string => s.replace(ANSI, '')

/** Hides each secret (the Hugging Face key) and anything that looks like a Hugging Face key, wherever it appears. */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let out = text
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('••••')
  return out.replace(/\bhf_[A-Za-z0-9]{8,}\b/g, 'hf_••••')
}

const UNITS: Record<string, number> = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3, K: 1e3, M: 1e6, G: 1e9 }

/** "1.2 GB", "340 MB", "12 KB". */
export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`
  return `${Math.max(0, Math.round(n))} bytes`
}

const amountBytes = (num: string, unit: string): number => Number(num) * (UNITS[unit.toUpperCase()] ?? 1)

/** What a line says. Blank lines, spinners and bars with nothing to read give null. */
export function parseLine(raw: string): OutputEvent | null {
  const line = stripAnsi(raw).trim()
  if (!line) return null
  let m = /^@@progress\s+(\d+)\s+(\d+)\s*$/.exec(line)
  if (m) return { kind: 'bytes', done: Number(m[1]), total: Number(m[2]) }
  m = /^@@licence\s+(\S+)/.exec(line)
  if (m) return { kind: 'licence', url: m[1] }
  m = /^@@gpu\s+(.+)$/.exec(line)
  if (m) return { kind: 'gpu', name: m[1].trim() === 'none' ? '' : m[1].trim() }
  m = /^@@error\s+(.+)$/.exec(line)
  if (m) return { kind: 'error', message: m[1].trim() }
  // pip --progress-bar raw
  m = /^Progress (\d+) of (\d+)$/.exec(line)
  if (m) return { kind: 'bytes', done: Number(m[1]), total: Number(m[2]) }
  // pip: "Downloading torch-2.9.1+cu128-cp313-cp313-win_amd64.whl (3.2 GB)", or the whole address from another index.
  m = /^Downloading\s+(\S+)(\s+\([^)]*\))?$/.exec(line)
  if (m) {
    const name = m[1].split('/').pop() ?? m[1]
    let decoded = name
    try {
      decoded = decodeURIComponent(name)
    } catch {
      /* keep it as printed */
    }
    return { kind: 'file', name: `${decoded}${m[2] ?? ''}` }
  }
  // Windows' installer: "██████▒▒▒▒  10.0 MB / 25.4 MB"
  m = /([\d.]+)\s*(KB|MB|GB|KiB|MiB|GiB)\s*\/\s*([\d.]+)\s*(KB|MB|GB|KiB|MiB|GiB)/i.exec(line)
  if (m) return { kind: 'bytes', done: amountBytes(m[1], m[2]), total: amountBytes(m[3], m[4]) }
  // A bar that is only a bar ("█████▒▒▒  45%"), or a spinner.
  m = /^[^A-Za-z]*?(\d{1,3}(?:\.\d+)?)\s*%[^A-Za-z]*$/.exec(line)
  if (m) return { kind: 'percent', percent: Math.min(100, Number(m[1])) }
  if (/^[-\\|/\s█▒▓░■□.]*$/.test(line)) return null
  return { kind: 'line', text: line.length > 300 ? `${line.slice(0, 297)}...` : line }
}

/**
 * How far a step is. A pip step downloads several files one after another, each with its own
 * "Progress x of y", so they are added up against roughly how much the step downloads (`expect`);
 * other steps report the whole step at once. The bar never moves back.
 */
export class StepProgress {
  private before = 0
  private current = 0
  private currentTotal = 0
  private whole: { done: number; total: number } | null = null
  private bare: number | null = null
  private shown: number | null = null

  constructor(
    private readonly mode: 'files' | 'whole',
    private readonly expect = 0
  ) {}

  take(ev: OutputEvent): void {
    if (ev.kind === 'percent') this.bare = ev.percent
    if (ev.kind === 'file' && this.mode === 'files') {
      this.before += Math.max(this.current, this.currentTotal)
      this.current = 0
      this.currentTotal = 0
    }
    if (ev.kind !== 'bytes') return
    if (this.mode === 'whole') {
      this.whole = { done: ev.done, total: ev.total }
      return
    }
    // A new file's bar starting without a "Downloading" line before it.
    if (ev.total !== this.currentTotal && ev.done < this.current) this.before += Math.max(this.current, this.currentTotal)
    this.current = ev.done
    this.currentTotal = ev.total
  }

  /** 0 to 100 (99 at most until the step ends), or null when it can't be told. */
  get percent(): number | null {
    let p: number | null = null
    if (this.mode === 'whole' && this.whole?.total) p = (this.whole.done * 100) / this.whole.total
    else if (this.mode === 'files') {
      const sum = this.before + this.current
      const of = Math.max(this.expect, this.before + this.currentTotal)
      if (of > 0 && sum > 0) p = (sum * 100) / of
    }
    if (p === null && this.bare !== null) p = this.bare
    if (p === null) return this.shown
    const next = Math.min(99, Math.max(0, Math.floor(p)))
    this.shown = this.shown === null ? next : Math.max(this.shown, next)
    return this.shown
  }

  /** "1.2 GB of 3.1 GB" (or "of about", for an estimate); '' when nothing is known. */
  get amount(): string {
    if (this.mode === 'whole') {
      if (!this.whole || !this.whole.done) return ''
      return this.whole.total ? `${formatBytes(this.whole.done)} of ${formatBytes(this.whole.total)}` : formatBytes(this.whole.done)
    }
    const sum = this.before + this.current
    if (!sum) return ''
    const known = this.before + this.currentTotal
    if (this.expect > known) return `${formatBytes(sum)} of about ${formatBytes(this.expect)}`
    return known ? `${formatBytes(sum)} of ${formatBytes(known)}` : formatBytes(sum)
  }
}

/** A step that failed, in plain words. */
export interface Failure {
  error: string
  need: 'python' | 'python-manual' | 'licence' | null
  link: string
}

const NO_SPACE = /No space left on device|Errno 28|not enough space on the disk|ENOSPC|disk is full/i
const OFFLINE =
  /Failed to establish a new connection|getaddrinfo failed|Temporary failure in name resolution|Name or service not known|Max retries exceeded|Read timed out|ConnectTimeout|ConnectionError|ConnectionResetError|Connection reset|ProxyError|SSLError|CERTIFICATE_VERIFY_FAILED|URLError|timed out|No internet|0x80072ee7|0x80072efd/i
const BLOCKED = /Permission denied|Access is denied|WinError 5\b|WinError 32\b|being used by another process|EACCES|EPERM/i
const NO_VENV = /ensurepip is not available|No module named venv|python3-venv/i
const NOT_FOR_THIS_PYTHON =
  /Could not find a version that satisfies|No matching distribution found|is not a supported wheel on this platform/i

/**
 * What went wrong, from the step's own words ("@@error ...") or the last lines it printed; else
 * `fallback`, the step's own plain sentence. Never a stack trace.
 */
export function explainFailure(recent: readonly string[], fallback: string, platform: NodeJS.Platform = process.platform): Failure {
  const text = recent.join('\n')
  const own = [...recent].reverse().find((l) => l.startsWith('@@error '))
  const licence = recent.find((l) => l.startsWith('@@licence '))
  if (licence) {
    return {
      error: 'Hugging Face asks for the voices’ licence to be accepted before they can download.',
      need: 'licence',
      link: licence.slice('@@licence '.length).trim()
    }
  }
  if (NO_SPACE.test(text))
    return { error: 'There isn’t enough free space on the disk. Free some up, then Try again.', need: null, link: '' }
  if (own) return { error: own.slice('@@error '.length).trim(), need: null, link: '' }
  if (NO_VENV.test(text)) {
    return {
      error:
        platform === 'linux'
          ? 'Python’s environment maker (venv) is missing. Install it (on Ubuntu: python3-venv), then Try again.'
          : 'This copy of Python can’t make environments. Install Python again from python.org, then Try again.',
      need: null,
      link: ''
    }
  }
  if (OFFLINE.test(text))
    return { error: 'Couldn’t reach the internet to download it. Check the connection, then Try again.', need: null, link: '' }
  if (BLOCKED.test(text)) {
    return {
      error: 'A file AI Write needed was blocked or in use (often by antivirus or another program). Close other programs, then Try again.',
      need: null,
      link: ''
    }
  }
  if (NOT_FOR_THIS_PYTHON.test(text)) {
    return {
      error: 'Part of it isn’t available for the Python on this computer. Install Python 3.13 from python.org, then Try again.',
      need: 'python-manual',
      link: PYTHON_PAGE
    }
  }
  return { error: fallback, need: null, link: '' }
}

/** Where to get Python by hand. */
export const PYTHON_PAGE = 'https://www.python.org/downloads/'
