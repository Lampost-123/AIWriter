// What this computer has for the speech engine: a Python to build its environments with (3.10 to 3.13,
// 64-bit), Windows' own installer (winget) to install Python with one click when there is none, and an
// NVIDIA graphics card for the voices. Each is found by running a program with an argument list (never a
// shell), so nothing typed anywhere reaches a command line. No Electron here: tests pass their own runner.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Runs a program and gives back what it printed; never throws (a program that can't start gives code -1). */
export type Runner = (command: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string }>

export const runProgram: Runner = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } },
      (error, stdout) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === 'number'
            ? ((error as { code: number }).code as number)
            : -1
          : 0
        resolve({ code, stdout: String(stdout ?? '') })
      }
    )
  })

export interface SystemEnv {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  exists: (path: string) => boolean
  run: Runner
}

export const realSystem = (): SystemEnv => ({ platform: process.platform, env: process.env, exists: existsSync, run: runProgram })

/** A Python found on this computer. */
export interface FoundPython {
  /** Its full path (what `sys.executable` says), used to run it from then on. */
  path: string
  version: [number, number, number]
}

/** The versions the speech engine works with, newest first. 3.14 breaks Breeze's PyTorch pins. */
export const PYTHON_VERSIONS = [13, 12, 11, 10] as const

/** Which version each environment prefers (MCreader's choices: its server on 3.13, Breeze on 3.12 first). */
export const PREFER: Record<'server' | 'voices', readonly number[]> = { server: [13, 12, 11, 10], voices: [12, 11, 13, 10] }

// Prints "3 13 1 64|C:\...\python.exe". Spaces in the path are fine: it comes last, after the bar.
const PROBE =
  'import sys, struct; print("%d %d %d %d|%s" % (sys.version_info[0], sys.version_info[1], sys.version_info[2], struct.calcsize("P") * 8, sys.executable))'

/** Reads the probe's line: the Python's version and path, if it is one the speech engine can use. */
export function parseProbe(stdout: string): FoundPython | null {
  const line = stdout.trim().split(/\r?\n/).pop() ?? ''
  const m = /^(\d+) (\d+) (\d+) (\d+)\|(.+)$/.exec(line.trim())
  if (!m) return null
  const version: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (version[0] !== 3 || !(PYTHON_VERSIONS as readonly number[]).includes(version[1])) return null
  // PyTorch has no 32-bit builds.
  if (Number(m[4]) !== 64) return null
  return { path: m[5].trim(), version }
}

/** The programs on PATH with one of these names, in PATH order. The Microsoft Store's stand-in "python" is skipped. */
export function onPath(names: readonly string[], sys: Pick<SystemEnv, 'platform' | 'env' | 'exists'>): string[] {
  const path = sys.env.PATH ?? sys.env.Path ?? ''
  const sep = sys.platform === 'win32' ? ';' : delimiter
  const out: string[] = []
  for (const dir of path.split(sep)) {
    if (!dir.trim()) continue
    if (sys.platform === 'win32' && /\\WindowsApps\\?$/i.test(dir.trim())) continue
    for (const name of names) {
      const file = join(dir.trim(), name)
      if (sys.exists(file) && !out.includes(file)) out.push(file)
    }
  }
  return out
}

/** Every place a usable Python might be, most likely first. Each is checked by running it. */
export function pythonCandidates(sys: Pick<SystemEnv, 'platform' | 'env' | 'exists'>): { command: string; args: string[] }[] {
  const out: { command: string; args: string[] }[] = []
  const add = (command: string, args: string[] = []): void => {
    if (!out.some((c) => c.command === command && c.args.join(' ') === args.join(' '))) out.push({ command, args })
  }
  if (sys.platform === 'win32') {
    // Where python.org's installer and winget put it (for Adam only, or for everyone).
    const local = sys.env.LOCALAPPDATA
    const programFiles = sys.env.ProgramFiles ?? 'C:\\Program Files'
    for (const minor of PYTHON_VERSIONS) {
      for (const dir of [
        local && join(local, 'Programs', 'Python', `Python3${minor}`),
        join(programFiles, `Python3${minor}`),
        `C:\\Python3${minor}`
      ]) {
        if (dir && sys.exists(join(dir, 'python.exe'))) add(join(dir, 'python.exe'))
      }
    }
    // The py launcher knows about every Python it installed.
    const launcher =
      onPath(['py.exe'], sys)[0] ??
      (sys.env.SystemRoot && sys.exists(join(sys.env.SystemRoot, 'py.exe')) ? join(sys.env.SystemRoot, 'py.exe') : null)
    if (launcher) for (const minor of PYTHON_VERSIONS) add(launcher, [`-3.${minor}`])
    for (const p of onPath(['python.exe', 'python3.exe'], sys)) add(p)
    return out
  }
  for (const p of onPath([...PYTHON_VERSIONS.map((m) => `python3.${m}`), 'python3'], sys)) add(p)
  if (sys.platform === 'darwin') {
    for (const minor of PYTHON_VERSIONS) {
      for (const p of [
        `/opt/homebrew/bin/python3.${minor}`,
        `/usr/local/bin/python3.${minor}`,
        `/Library/Frameworks/Python.framework/Versions/3.${minor}/bin/python3`
      ]) {
        if (sys.exists(p)) add(p)
      }
    }
  }
  return out
}

/** Every usable Python on this computer, each once. */
export async function findPythons(sys: SystemEnv): Promise<FoundPython[]> {
  const found: FoundPython[] = []
  for (const c of pythonCandidates(sys)) {
    const { code, stdout } = await sys.run(c.command, [...c.args, '-c', PROBE], 20_000)
    if (code !== 0) continue
    const p = parseProbe(stdout)
    if (p && !found.some((f) => f.path.toLowerCase() === p.path.toLowerCase())) found.push(p)
  }
  return found
}

/** The Python an environment is made with: the preferred version that is here, or none. */
export function pickPython(found: readonly FoundPython[], prefer: readonly number[]): FoundPython | null {
  for (const minor of prefer) {
    const p = found.find((f) => f.version[1] === minor)
    if (p) return p
  }
  return null
}

/** Windows' own installer, when this Windows has it. */
export function findWinget(sys: Pick<SystemEnv, 'platform' | 'env' | 'exists'>): string | null {
  if (sys.platform !== 'win32') return null
  const local = sys.env.LOCALAPPDATA
  const alias = local ? join(local, 'Microsoft', 'WindowsApps', 'winget.exe') : null
  if (alias && sys.exists(alias)) return alias
  const path = sys.env.PATH ?? sys.env.Path ?? ''
  for (const dir of path.split(';')) {
    const file = dir.trim() && join(dir.trim(), 'winget.exe')
    if (file && sys.exists(file)) return file
  }
  return null
}

/** The winget package: the Python MCreader's speech server was built and tested on. */
export const WINGET_PYTHON = 'Python.Python.3.13'

/** Installs Python for Adam only, silently, agreeing to the package's terms (he clicked Install Python). */
export const wingetArgs = (): string[] => [
  'install',
  '--id',
  WINGET_PYTHON,
  '--exact',
  '--source',
  'winget',
  '--scope',
  'user',
  '--silent',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--disable-interactivity'
]

/** The NVIDIA card's name from nvidia-smi (installed with its driver); '' when there is none. */
export async function findNvidia(sys: SystemEnv): Promise<string> {
  if (sys.platform === 'darwin') return ''
  const tries = onPath([sys.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi'], sys)
  if (sys.platform === 'win32') {
    for (const p of [
      sys.env.SystemRoot && join(sys.env.SystemRoot, 'System32', 'nvidia-smi.exe'),
      join(sys.env.ProgramFiles ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
    ]) {
      if (p && sys.exists(p) && !tries.includes(p)) tries.push(p)
    }
  }
  for (const smi of tries) {
    const { code, stdout } = await sys.run(smi, ['--query-gpu=name', '--format=csv,noheader'], 10_000)
    const name = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean)
    if (code === 0 && name) return name
  }
  return ''
}
