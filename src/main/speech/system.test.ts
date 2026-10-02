import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import {
  findNvidia,
  findPythons,
  findWinget,
  onPath,
  parseProbe,
  pickPython,
  pythonCandidates,
  PREFER,
  type Runner,
  type SystemEnv
} from './system'

/** The Windows computers described here write their paths the Windows way, whatever runs the tests. */
const join = win32.join

/** A computer with these files, answering each program from `answers` (by its path and first argument). */
function computer(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  files: string[],
  answers: Record<string, string> = {}
): SystemEnv & { ran: string[][] } {
  const ran: string[][] = []
  const run: Runner = async (command, args) => {
    ran.push([command, ...args])
    const key = [command, ...args.slice(0, args[0] === '-c' ? 0 : 1)].join(' ')
    const out = answers[key] ?? answers[command]
    return out === undefined ? { code: 1, stdout: '' } : { code: 0, stdout: out }
  }
  return { platform, env, exists: (p) => files.includes(p), run, ran }
}

describe('finding Python', () => {
  it('reads the probe: version, 64-bit, and its full path (spaces and all)', () => {
    expect(parseProbe('3 13 1 64|C:\\Users\\Adam Doherty\\AppData\\Local\\Programs\\Python\\Python313\\python.exe\r\n')).toEqual({
      path: 'C:\\Users\\Adam Doherty\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
      version: [3, 13, 1]
    })
    expect(parseProbe('some warning\n3 10 12 64|/usr/bin/python3.10\n')).toEqual({ path: '/usr/bin/python3.10', version: [3, 10, 12] })
  })

  it('turns down the ones the speech engine can’t use', () => {
    expect(parseProbe('3 14 0 64|/usr/bin/python3.14')).toBeNull()
    expect(parseProbe('3 9 18 64|/usr/bin/python3.9')).toBeNull()
    expect(parseProbe('2 7 18 64|/usr/bin/python2')).toBeNull()
    expect(parseProbe('3 13 1 32|C:\\Python313-32\\python.exe')).toBeNull()
    expect(parseProbe('Python was not found; run without arguments to install from the Microsoft Store')).toBeNull()
    expect(parseProbe('')).toBeNull()
  })

  it('looks along PATH in order, each program once, skipping the Microsoft Store’s stand-in', () => {
    const store = 'C:\\Users\\Adam\\AppData\\Local\\Microsoft\\WindowsApps'
    const real = 'C:\\Python312'
    const sys = computer('win32', { PATH: `${store};${real};${real}` }, [join(store, 'python.exe'), join(real, 'python.exe')])
    expect(onPath(['python.exe'], sys)).toEqual([join(real, 'python.exe')])
  })

  it('on Windows tries where python.org’s installer and winget put it, then the py launcher, then PATH', () => {
    const local = 'C:\\Users\\Adam\\AppData\\Local'
    const mine = join(local, 'Programs', 'Python', 'Python313', 'python.exe')
    const launcher = join('C:\\Windows', 'py.exe')
    const onPathPython = join('C:\\Tools', 'python.exe')
    const sys = computer('win32', { LOCALAPPDATA: local, SystemRoot: 'C:\\Windows', PATH: 'C:\\Tools' }, [mine, launcher, onPathPython])
    const c = pythonCandidates(sys)
    expect(c[0]).toEqual({ command: mine, args: [] })
    expect(c).toContainEqual({ command: launcher, args: ['-3.13'] })
    expect(c).toContainEqual({ command: launcher, args: ['-3.10'] })
    expect(c[c.length - 1]).toEqual({ command: onPathPython, args: [] })
  })

  it('elsewhere tries python3.13 down to python3.10, then python3', () => {
    const sys = computer('linux', { PATH: '/usr/bin' }, ['/usr/bin/python3.12', '/usr/bin/python3'])
    expect(pythonCandidates(sys)).toEqual([
      { command: '/usr/bin/python3.12', args: [] },
      { command: '/usr/bin/python3', args: [] }
    ])
  })

  it('runs each candidate once and keeps each Python once', async () => {
    const sys = computer('linux', { PATH: '/usr/bin' }, ['/usr/bin/python3.12', '/usr/bin/python3'], {
      '/usr/bin/python3.12': '3 12 3 64|/usr/bin/python3.12',
      '/usr/bin/python3': '3 12 3 64|/usr/bin/python3.12'
    })
    expect(await findPythons(sys)).toEqual([{ path: '/usr/bin/python3.12', version: [3, 12, 3] }])
    expect(sys.ran.map((r) => r[0])).toEqual(['/usr/bin/python3.12', '/usr/bin/python3'])
    // Asked with an argument list: -c and the probe, never through a shell.
    expect(sys.ran[0][1]).toBe('-c')
  })

  it('finds none when none answers', async () => {
    expect(await findPythons(computer('linux', { PATH: '/usr/bin' }, ['/usr/bin/python3']))).toEqual([])
  })

  it('picks the version each environment prefers', () => {
    const found = [
      { path: 'a', version: [3, 13, 1] as [number, number, number] },
      { path: 'b', version: [3, 12, 9] as [number, number, number] }
    ]
    expect(pickPython(found, PREFER.server)?.path).toBe('a')
    expect(pickPython(found, PREFER.voices)?.path).toBe('b')
    expect(pickPython([], PREFER.server)).toBeNull()
  })
})

describe('Windows’ installer', () => {
  it('is found where Windows keeps it, or on PATH', () => {
    const local = 'C:\\Users\\Adam\\AppData\\Local'
    const alias = join(local, 'Microsoft', 'WindowsApps', 'winget.exe')
    expect(findWinget(computer('win32', { LOCALAPPDATA: local }, [alias]))).toBe(alias)
    expect(findWinget(computer('win32', { PATH: 'C:\\bin' }, [join('C:\\bin', 'winget.exe')]))).toBe(join('C:\\bin', 'winget.exe'))
    expect(findWinget(computer('win32', { LOCALAPPDATA: local }, []))).toBeNull()
  })

  it('is never looked for off Windows', () => {
    expect(findWinget(computer('linux', { PATH: '/usr/bin' }, ['/usr/bin/winget.exe']))).toBeNull()
  })
})

describe('the graphics card', () => {
  it('is named by nvidia-smi', async () => {
    const sys = computer('linux', { PATH: '/usr/bin' }, ['/usr/bin/nvidia-smi'], {
      '/usr/bin/nvidia-smi --query-gpu=name': 'NVIDIA GeForce RTX 4090\n'
    })
    expect(await findNvidia(sys)).toBe('NVIDIA GeForce RTX 4090')
  })

  it('is found in Windows’ own folder too', async () => {
    const smi = join('C:\\Windows', 'System32', 'nvidia-smi.exe')
    const sys = computer('win32', { SystemRoot: 'C:\\Windows', PATH: '' }, [smi], { [smi]: 'NVIDIA GeForce RTX 3060 Laptop GPU\r\n' })
    expect(await findNvidia(sys)).toBe('NVIDIA GeForce RTX 3060 Laptop GPU')
  })

  it('is none without nvidia-smi, when it fails, or on a Mac', async () => {
    expect(await findNvidia(computer('linux', { PATH: '/usr/bin' }, []))).toBe('')
    expect(await findNvidia(computer('linux', { PATH: '/usr/bin' }, ['/usr/bin/nvidia-smi']))).toBe('')
    expect(await findNvidia(computer('darwin', { PATH: '/usr/bin' }, ['/usr/bin/nvidia-smi'], { '/usr/bin/nvidia-smi': 'x' }))).toBe('')
  })
})
