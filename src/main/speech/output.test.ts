import { describe, expect, it } from 'vitest'
import { explainFailure, formatBytes, LineSplitter, parseLine, scrub, StepProgress, stripAnsi } from './output'

describe('reading what a download step prints', () => {
  it('splits output into lines however it arrives', () => {
    const s = new LineSplitter()
    expect(s.push('Collecting fast')).toEqual([])
    expect(s.push('api\r\nProgress 1 of 9\rProgress 5 of 9\rProg')).toEqual(['Collecting fastapi', 'Progress 1 of 9', 'Progress 5 of 9'])
    expect(s.push('ress 9 of 9\n')).toEqual(['Progress 9 of 9'])
    expect(s.push('last line, no newline')).toEqual([])
    expect(s.flush()).toEqual(['last line, no newline'])
    expect(s.flush()).toEqual([])
  })

  it('reads pip’s raw progress, the install tool’s own lines and Windows’ installer', () => {
    expect(parseLine('Progress 1048576 of 3200000000')).toEqual({ kind: 'bytes', done: 1048576, total: 3200000000 })
    expect(parseLine('@@progress 512 1024')).toEqual({ kind: 'bytes', done: 512, total: 1024 })
    expect(parseLine('@@licence https://huggingface.co/BreezeBlue/breeze-tts-2')).toEqual({
      kind: 'licence',
      url: 'https://huggingface.co/BreezeBlue/breeze-tts-2'
    })
    expect(parseLine('@@gpu NVIDIA GeForce RTX 4090')).toEqual({ kind: 'gpu', name: 'NVIDIA GeForce RTX 4090' })
    expect(parseLine('@@gpu none')).toEqual({ kind: 'gpu', name: '' })
    expect(parseLine('@@error The voices didn’t finish downloading.')).toEqual({
      kind: 'error',
      message: 'The voices didn’t finish downloading.'
    })
    expect(parseLine('  ██████████▒▒▒▒▒▒  10.0 MB / 25.4 MB')).toEqual({ kind: 'bytes', done: 10e6, total: 25.4e6 })
    expect(parseLine('   ████████▒▒▒  45%')).toEqual({ kind: 'percent', percent: 45 })
  })

  it('names the file pip downloads, from a plain name or a whole address', () => {
    expect(parseLine('  Downloading numpy-2.3.4-cp313-cp313-win_amd64.whl (12.9 MB)')).toEqual({
      kind: 'file',
      name: 'numpy-2.3.4-cp313-cp313-win_amd64.whl (12.9 MB)'
    })
    expect(parseLine('Downloading https://download.pytorch.org/whl/cu128/torch-2.9.1%2Bcu128-cp313-cp313-win_amd64.whl (3.2 GB)')).toEqual({
      kind: 'file',
      name: 'torch-2.9.1+cu128-cp313-cp313-win_amd64.whl (3.2 GB)'
    })
  })

  it('keeps plain lines, drops spinners and blank lines, and shortens very long lines', () => {
    expect(parseLine('Successfully installed fastapi-0.118.0')).toEqual({ kind: 'line', text: 'Successfully installed fastapi-0.118.0' })
    expect(parseLine('   ')).toBeNull()
    expect(parseLine('|/-\\')).toBeNull()
    expect(parseLine('\u001b[32mInstalling collected packages\u001b[0m')).toEqual({ kind: 'line', text: 'Installing collected packages' })
    const long = parseLine('x'.repeat(400))
    expect(long?.kind === 'line' && long.text.length).toBe(300)
    expect(stripAnsi('\u001b[1;31mred\u001b[0m')).toBe('red')
  })

  it('hides the Hugging Face key, and anything that looks like one, wherever it appears', () => {
    const key = 'hf_AbCdEfGhIjKlMnOpQrStUvWxYz012345'
    expect(scrub(`Using token ${key} for the download`, [key])).toBe('Using token •••• for the download')
    expect(scrub('Authorization: Bearer hf_ZyXwVuTsRqPoNmLk')).toBe('Authorization: Bearer hf_••••')
    expect(scrub(`url?token=${key}&x=1`, [key])).not.toContain(key)
    // Too short to be a key: not hidden (it would hide ordinary words).
    expect(scrub('the cat sat', ['at'])).toBe('the cat sat')
  })

  it('says sizes in plain words', () => {
    expect(formatBytes(3_200_000_000)).toBe('3.2 GB')
    expect(formatBytes(145_000_000)).toBe('145 MB')
    expect(formatBytes(12_400)).toBe('12 KB')
    expect(formatBytes(512)).toBe('512 bytes')
  })
})

describe('a step’s progress', () => {
  it('adds up the files pip downloads, against roughly what the step downloads', () => {
    const p = new StepProgress('files', 400e6)
    expect(p.percent).toBeNull()
    expect(p.amount).toBe('')
    p.take({ kind: 'file', name: 'transformers-4.57.3-py3-none-any.whl (12.0 MB)' })
    p.take({ kind: 'bytes', done: 6e6, total: 12e6 })
    expect(p.percent).toBe(1)
    expect(p.amount).toBe('6 MB of about 400 MB')
    p.take({ kind: 'bytes', done: 12e6, total: 12e6 })
    p.take({ kind: 'file', name: 'qwen_tts-0.1.1-py3-none-any.whl (188 MB)' })
    p.take({ kind: 'bytes', done: 188e6, total: 188e6 })
    expect(p.percent).toBe(50)
    expect(p.amount).toBe('200 MB of about 400 MB')
  })

  it('counts a new file whose bar starts without a “Downloading” line', () => {
    const p = new StepProgress('files')
    p.take({ kind: 'bytes', done: 30e6, total: 30e6 })
    p.take({ kind: 'bytes', done: 5e6, total: 10e6 })
    expect(p.amount).toBe('35 MB of 40 MB')
    expect(p.percent).toBe(87)
  })

  it('never goes back, and stays under 100 until the step ends', () => {
    const p = new StepProgress('whole')
    p.take({ kind: 'bytes', done: 60, total: 100 })
    expect(p.percent).toBe(60)
    p.take({ kind: 'bytes', done: 10, total: 100 })
    expect(p.percent).toBe(60)
    p.take({ kind: 'bytes', done: 100, total: 100 })
    expect(p.percent).toBe(99)
  })

  it('reads a whole step’s bytes, or a bare percentage', () => {
    const w = new StepProgress('whole')
    w.take({ kind: 'bytes', done: 1.2e9, total: 3.1e9 })
    expect(w.amount).toBe('1.2 GB of 3.1 GB')
    expect(w.percent).toBe(38)
    const bare = new StepProgress('whole')
    bare.take({ kind: 'percent', percent: 45 })
    expect(bare.percent).toBe(45)
    expect(bare.amount).toBe('')
  })
})

describe('what went wrong, in plain words', () => {
  const fallback = 'The voices didn’t finish downloading. Check the internet connection, then Try again.'

  it('asks for the licence, with its page, when Hugging Face wants it accepted', () => {
    const f = explainFailure(['Downloading the voices', '@@licence https://huggingface.co/BreezeBlue/breeze-tts-2'], fallback)
    expect(f.need).toBe('licence')
    expect(f.link).toBe('https://huggingface.co/BreezeBlue/breeze-tts-2')
    expect(f.error).toMatch(/licence to be accepted/)
  })

  it('asks for a new key when Hugging Face turned the saved one down, not for the licence again', () => {
    const f = explainFailure(
      [
        'Downloading the voices',
        '@@key',
        '@@error Hugging Face didn’t accept the saved key. Make a new key with read access, save it, then Try again.'
      ],
      fallback
    )
    expect(f).toEqual({ error: 'Hugging Face didn’t accept the saved key.', need: 'key', link: 'https://huggingface.co/settings/tokens' })
    expect(parseLine('@@key')).toEqual({ kind: 'key' })
  })

  it('says when the disk is full, before anything else', () => {
    const f = explainFailure(
      ['ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device', '@@error It stopped.'],
      fallback
    )
    expect(f.error).toBe('There isn’t enough free space on the disk. Free some up, then Try again.')
  })

  it('uses the install tool’s own words', () => {
    expect(
      explainFailure(['Traceback (most recent call last):', '@@error Breeze’s code didn’t download. Try again.'], fallback).error
    ).toBe('Breeze’s code didn’t download. Try again.')
  })

  it('explains the internet, a blocked file, a Python without venv and a Python too new', () => {
    expect(
      explainFailure(["WARNING: Retrying after connection broken by 'NewConnectionError: Failed to establish a new connection'"], fallback)
        .error
    ).toBe('Couldn’t reach the internet to download it. Check the connection, then Try again.')
    expect(
      explainFailure(
        ['PermissionError: [WinError 32] The process cannot access the file because it is being used by another process'],
        fallback
      ).error
    ).toMatch(/blocked or in use/)
    expect(explainFailure(['Error: Command returned non-zero exit status 1. ensurepip is not available'], fallback, 'linux').error).toMatch(
      /python3-venv/
    )
    expect(explainFailure(['ensurepip is not available'], fallback, 'win32').error).toMatch(/Install Python again/)
    const tooNew = explainFailure(
      ['ERROR: Could not find a version that satisfies the requirement torch==2.9.1 (from versions: none)'],
      fallback
    )
    expect(tooNew.need).toBe('python-manual')
    expect(tooNew.link).toBe('https://www.python.org/downloads/')
  })

  it('falls back to the step’s own sentence, never a stack trace', () => {
    const f = explainFailure(['Traceback (most recent call last):', '  File "x.py", line 3, in <module>', 'KeyError: 7'], fallback)
    expect(f).toEqual({ error: fallback, need: null, link: '' })
  })
})
