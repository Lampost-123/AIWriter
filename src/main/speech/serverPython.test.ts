// The speech server's own Python, where it needs nothing but Python itself: dictation's clean-up of what
// was said (speech-server/app/stt.py). Skipped on a computer without Python 3.10 or newer.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const SERVER = resolve(__dirname, '..', '..', '..', 'speech-server')

function findPython(): string | null {
  for (const p of ['python3', 'python']) {
    const r = spawnSync(p, ['-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim() === 'True') return p
  }
  return null
}

const python = findPython()

function clean(texts: string[]): string[] {
  const code = 'import json, sys; from app.stt import clean; print(json.dumps([clean(t) for t in json.loads(sys.stdin.read())]))'
  const r = spawnSync(python as string, ['-c', code], {
    cwd: SERVER,
    input: JSON.stringify(texts),
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', AIWRITE_SPEECH_HOME: join(SERVER, 'no-such-folder') }
  })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout) as string[]
}

describe.skipIf(!python)('dictation’s clean-up of what was said', () => {
  it('drops fillers and stutters', () => {
    expect(
      clean([
        'Um, I think that the the door was open.',
        'I I want to go to the the market, er, today.',
        'The erm butler did it',
        'Mara said, um, no.'
      ])
    ).toEqual(['I think that the door was open.', 'I want to go to the market today.', 'The butler did it', 'Mara said no.'])
  })

  it('keeps what is meant: real doubles, “hmm”, “uh-huh” and “uh oh”', () => {
    const kept = ['He had had enough.', 'Hmm, maybe.', 'Uh-huh, she said.', 'Uh-oh.', 'Uh oh, the door.', 'He paused... then spoke.']
    expect(clean(kept)).toEqual(kept)
  })

  it('leaves one pause where a filler sat between two', () => {
    expect(clean(['Wait... um... what?', 'Wait… uh… what?'])).toEqual(['Wait... what?', 'Wait… what?'])
  })

  it('types nothing for nothing but a filler', () => {
    expect(clean(['Ummm.', 'uh', ''])).toEqual(['', '', ''])
  })
})
