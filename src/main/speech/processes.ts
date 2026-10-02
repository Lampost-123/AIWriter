// Starting and ending the speech engine's programs (the server, a download step) without a console window,
// and ending each with everything it started: on Windows a venv's python.exe is a launcher that runs the
// real Python as a second process, and the server runs Breeze as a third. No Electron here.
import { spawnSync, type ChildProcess } from 'node:child_process'

/** Started in a process group of its own off Windows, so the group can be ended together. */
export const ownGroup = (platform: NodeJS.Platform = process.platform): boolean => platform !== 'win32'

/** Ends `child` and every process it started. Synchronous, so it also works as AI Write quits. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return
  if (platform === 'win32') {
    // /T: the whole tree; /F: without asking (there is no window to ask).
    const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 })
    if (r.status === 0) return
  } else {
    try {
      process.kill(-pid, 'SIGTERM')
      return
    } catch {
      /* not a group leader after all: end it alone below */
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
}

/** Environment for a program the speech engine runs: AI Write's own, less what would confuse Python, plus `extra`. */
export function childEnv(drop: readonly string[], extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !drop.includes(k.toUpperCase())) env[k] = v
  return { ...env, ...extra }
}
