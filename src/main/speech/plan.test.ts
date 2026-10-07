import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { cleanHuggingFaceKey, HF_KEY_SECRET } from './hfkey'
import { speechPaths, venvPython } from './paths'
import {
  BREEZE_PACKAGES,
  DOWNLOAD_NAMES,
  DROP_ENV,
  planFor,
  pythonStep,
  SOUND_PACKAGES,
  SOUND_TORCH,
  stepEnv,
  TORCH,
  TORCH_INDEX,
  type PlanInput,
  type Step
} from './plan'
import { buildStatus } from './status'
import { wingetArgs } from './system'

const KEY = 'hf_TestKeyThatMustNeverLeaveSecrets0123'
const userData = join('/data', 'AI Write')
const source = join('/app', 'resources', 'speech-server')

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    paths: speechPaths(userData, source, 'win32'),
    platform: 'win32',
    basePython: join('/py', 'python.exe'),
    serverVenv: false,
    breezeVenv: false,
    hfKey: null,
    ...over
  }
}

const ids = (steps: Step[]): string[] => steps.map((s) => s.id)

describe('the download steps', () => {
  it('are programs with argument lists, never a command line for a shell', () => {
    for (const kind of ['server', 'voices', 'parakeet', 'whisper', 'sounds'] as const) {
      for (const step of planFor(kind, input({ hfKey: KEY }))) {
        expect(typeof step.command).toBe('string')
        expect(Array.isArray(step.args)).toBe(true)
        expect(step.args.every((a) => typeof a === 'string')).toBe(true)
        // Nothing like "cmd /c" or "sh -c", and no pipes or chaining in the program's name.
        expect(step.command).not.toMatch(/[|&;<>]|\bcmd(\.exe)?$|\bsh$/i)
        expect(step.args).not.toContain('/c')
        expect(step.args).not.toContain('-c')
        expect(step.label).not.toMatch(/\b(LLM|API|token|prompt|generation|entity)\b/i)
        // Names Adam needn't know stay out of what he reads.
        expect(`${step.label} ${step.fails}`).not.toMatch(/PyTorch|torch|CUDA|pip\b|venv/i)
        expect(step.fails.length).toBeGreaterThan(10)
      }
    }
  })

  it('make the server’s environment with the Python found, then install its packages into the speech folder', () => {
    const i = input()
    const steps = planFor('server', i)
    expect(ids(steps)).toEqual(['venv', 'pip', 'packages', 'check'])
    expect(steps[0]).toMatchObject({ command: join('/py', 'python.exe'), args: ['-m', 'venv', '--clear', i.paths.venv] })
    expect(i.paths.venv).toBe(join(userData, 'speech', 'venv'))
    expect(steps[1].command).toBe(venvPython(i.paths.venv, 'win32'))
    expect(steps[2].args).toEqual(
      expect.arrayContaining(['-m', 'pip', 'install', '--progress-bar', 'raw', '-r', join(source, 'requirements.txt')])
    )
    expect(steps[2].progress).toBe('files')
    expect(steps[3].args).toEqual([join(source, 'tools', 'install.py'), 'check-server'])
  })

  it('set the server’s environment up afresh to repair it, with the dictation engines already downloaded', () => {
    const steps = planFor('server', input({ serverVenv: false, dictation: ['parakeet', 'whisper'] }))
    expect(ids(steps)).toEqual(['venv', 'pip', 'packages', 'check'])
    expect(steps[0].args).toContain('--clear')
    expect(steps[2].args).toEqual(expect.arrayContaining(['sherpa-onnx>=1.10', 'faster-whisper>=1.0']))
    expect(steps[2].expect).toBeGreaterThan(planFor('server', input())[2].expect ?? 0)
    expect(steps[3].fails).toMatch(/set it up afresh; the voices are kept/)
    // Its environment is there: only the server's own packages are checked again.
    expect(planFor('server', input({ serverVenv: true, dictation: ['parakeet'] }))[1].args).not.toContain('sherpa-onnx>=1.10')
  })

  it('check the voices last, which leaves the mark that says they are downloaded', () => {
    const i = input()
    const check = planFor('voices', i).at(-1)
    expect(check?.args).toEqual([join(source, 'tools', 'install.py'), 'breeze-check', '--root', i.paths.home])
    expect(check?.label).toBe('Checking the voices')
  })

  it('skip the environment when it is already there (Try again carries on)', () => {
    expect(ids(planFor('server', input({ serverVenv: true })))).toEqual(['pip', 'packages', 'check'])
    expect(ids(planFor('voices', input({ breezeVenv: true })))).toEqual([
      'pip',
      'torch',
      'packages',
      'torch-check',
      'code',
      'weights',
      'check'
    ])
  })

  it('put the voices in their own environment, with PyTorch for NVIDIA cards, and Breeze’s pinned packages', () => {
    const i = input()
    const steps = planFor('voices', i)
    expect(ids(steps)).toEqual(['venv', 'pip', 'torch', 'packages', 'torch-check', 'code', 'weights', 'check'])
    const breeze = join(userData, 'speech', 'venvs', 'breeze')
    expect(steps[0].args).toEqual(['-m', 'venv', '--clear', breeze])
    const torch = steps[2]
    expect(torch.command).toBe(venvPython(breeze, 'win32'))
    expect(torch.args).toEqual(expect.arrayContaining([...TORCH, '--index-url', TORCH_INDEX]))
    expect(steps[3].args).toEqual(expect.arrayContaining(BREEZE_PACKAGES))
    expect(steps[6].env?.HF_HOME).toBe(join(userData, 'speech', 'models', 'hf'))
  })

  it('use PyTorch’s own build on a Mac (no NVIDIA there)', () => {
    const steps = planFor('voices', input({ platform: 'darwin', paths: speechPaths(userData, source, 'darwin') }))
    expect(ids(steps)).not.toContain('torch-check')
    expect(steps.find((s) => s.id === 'torch')?.args).not.toContain('--index-url')
  })

  it('put the voices in AI Write’s own speech folder', () => {
    const i = input({ paths: speechPaths(userData, source, 'win32') })
    for (const step of planFor('voices', i))
      if (step.args.includes('--root')) expect(step.args[step.args.indexOf('--root') + 1]).toBe(i.paths.home)
  })

  it('add Parakeet or Whisper to the server’s environment, then their English model', () => {
    const i = input({ serverVenv: true })
    for (const kind of ['parakeet', 'whisper'] as const) {
      const steps = planFor(kind, i)
      expect(ids(steps)).toEqual(['packages', 'model', 'check'])
      expect(steps.every((s) => s.command === i.paths.python)).toBe(true)
      expect(steps[1].args).toEqual([join(source, 'tools', 'install.py'), `${kind}-model`, '--home', i.paths.home])
    }
    expect(planFor('parakeet', i)[0].args).toContain('sherpa-onnx>=1.10')
    expect(planFor('whisper', i)[0].args).toContain('faster-whisper>=1.0')
  })

  it('put the sound effects in their own environment, with the voices’ PyTorch for NVIDIA cards and exact pins', () => {
    const i = input()
    const steps = planFor('sounds', i)
    expect(ids(steps)).toEqual(['venv', 'pip', 'torch', 'packages', 'torch-check', 'weights', 'check'])
    const sound = join(userData, 'speech', 'venvs', 'sound')
    expect(steps[0].args).toEqual(['-m', 'venv', '--clear', sound])
    expect(steps.slice(1).every((s) => s.command === venvPython(sound, 'win32'))).toBe(true)
    // The same PyTorch as the voices, with its torchvision, from the CUDA build's own index.
    expect(SOUND_TORCH).toEqual([...TORCH, 'torchvision==0.24.1'])
    expect(steps[2].args).toEqual(expect.arrayContaining([...SOUND_TORCH, '--index-url', TORCH_INDEX]))
    expect(steps[2].expect).toBeGreaterThan(3e9)
    // Every package pinned to one version, and never stable-audio-tools (it would swap PyTorch for the plain build).
    expect(steps[3].args).toEqual(expect.arrayContaining(SOUND_PACKAGES))
    expect(SOUND_PACKAGES.every((pin) => /^[\w-]+==\d+(\.\d+)+$/.test(pin))).toBe(true)
    expect(SOUND_PACKAGES).toEqual(expect.arrayContaining(['diffusers==0.40.0', 'transformers==5.18.0']))
    expect(steps[3].args.join(' ')).not.toMatch(/stable-audio-tools|torch==/)
    expect(steps[4].args).toEqual([join(source, 'tools', 'install.py'), 'sound-torch'])
    // The models go into the speech folder's Hugging Face cache, beside the voices'.
    expect(steps[5].args).toEqual([join(source, 'tools', 'install.py'), 'sound-weights', '--root', i.paths.home])
    expect(steps[5].env?.HF_HOME).toBe(join(userData, 'speech', 'models', 'hf'))
    expect(steps[5].label).toBe('Downloading the sound effects model')
    // Checked last, which leaves the mark that says they are downloaded.
    expect(steps[6].args).toEqual([join(source, 'tools', 'install.py'), 'sound-check', '--root', i.paths.home])
    expect(DOWNLOAD_NAMES.sounds).toBe('the sound effects')
  })

  it('fetch the studio voices and the word check with the voices’ environment, never with the Hugging Face key', () => {
    const i = input({ hfKey: KEY })
    const steps = planFor('studio', i)
    const python = venvPython(join(i.paths.home, 'venvs', 'breeze'), 'win32')
    expect(ids(steps)).toEqual(['voices', 'listener', 'check'])
    expect(steps.every((s) => s.command === python)).toBe(true)
    expect(steps[0].args).toEqual([join(source, 'tools', 'install.py'), 'studio-voices', '--root', i.paths.home])
    expect(steps[1].env?.HF_HOME).toBe(join(userData, 'speech', 'models', 'hf'))
    expect(steps[2].args).toEqual([join(source, 'tools', 'install.py'), 'studio-check', '--root', i.paths.home])
    expect(JSON.stringify(steps)).not.toContain(KEY)
    expect(DOWNLOAD_NAMES.studio).toBe('the studio voices')
  })

  it('skip the sound effects’ environment when it is there, and use PyTorch’s own build on a Mac', () => {
    expect(ids(planFor('sounds', input({ soundVenv: true })))).toEqual(['pip', 'torch', 'packages', 'torch-check', 'weights', 'check'])
    const mac = planFor('sounds', input({ platform: 'darwin', paths: speechPaths(userData, source, 'darwin') }))
    expect(ids(mac)).not.toContain('torch-check')
    expect(mac.find((s) => s.id === 'torch')?.args).not.toContain('--index-url')
  })

  it('install Python with Windows’ own installer, for Adam only and without questions', () => {
    const step = pythonStep('C:\\Users\\Adam\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe')
    expect(step.args).toEqual(wingetArgs())
    expect(step.args).toEqual(expect.arrayContaining(['install', '--id', 'Python.Python.3.13', '--exact', '--scope', 'user', '--silent']))
    expect(step.args).toEqual(
      expect.arrayContaining(['--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'])
    )
    // If it fails, python.org is linked as the way to do it by hand.
    expect(step.byHand).toBe('https://www.python.org/downloads/')
  })

  it('keep pip’s, Python’s and Hugging Face’s own files in the speech folder’s cache, and never inherit a key', () => {
    const p = speechPaths(userData, source, 'linux')
    const env = stepEnv(p)
    expect(env.PIP_CACHE_DIR).toBe(join(userData, 'speech', 'cache', 'pip'))
    expect(env.TMPDIR).toBe(join(userData, 'speech', 'cache', 'tmp'))
    // Not ~/.cache/huggingface, where a key saved for another app would be found and used.
    expect(env.HF_HOME).toBe(join(userData, 'speech', 'cache', 'hf'))
    expect(env.PYTHONUNBUFFERED).toBe('1')
    expect(env).not.toHaveProperty('HF_TOKEN')
    expect(DROP_ENV).toEqual(expect.arrayContaining(['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV']))
    // Nor anything that would put the downloads somewhere else, or keep them offline.
    expect(DROP_ENV).toEqual(expect.arrayContaining(['HF_HOME', 'HF_HUB_CACHE', 'HUGGINGFACE_HUB_CACHE', 'HF_HUB_OFFLINE', 'PIP_USER']))
    expect(DROP_ENV.every((name) => name === name.toUpperCase())).toBe(true)
  })
})

describe('the Hugging Face key never leaves secrets', () => {
  it('goes to the voices’ and the sound effects’ weights steps only, as an environment variable', () => {
    for (const kind of ['server', 'voices', 'parakeet', 'whisper', 'sounds'] as const) {
      for (const step of planFor(kind, input({ hfKey: KEY }))) {
        expect(step.args.join(' ')).not.toContain(KEY)
        expect(step.command).not.toContain(KEY)
        if ((kind === 'voices' || kind === 'sounds') && step.id === 'weights') expect(step.env?.HF_TOKEN).toBe(KEY)
        else expect(JSON.stringify(step.env ?? {})).not.toContain(KEY)
      }
    }
  })

  it('is not passed at all when none is saved', () => {
    expect(JSON.stringify(planFor('voices', input()))).not.toContain('HF_TOKEN')
    expect(JSON.stringify(planFor('sounds', input()))).not.toContain('HF_TOKEN')
  })

  it('shows in the status only as “there is one”', () => {
    const status = buildStatus({
      managed: true,
      starting: false,
      health: null,
      problem: '',
      repair: false,
      picked: 'none',
      installed: { server: true, voices: null, parakeet: false, whisper: false },
      nvidia: '',
      download: null,
      queued: [],
      hfKey: true,
      folder: '/data/speech',
      address: 'http://127.0.0.1:8766/v1'
    })
    expect(status.hfKey).toBe(true)
    expect(JSON.stringify(status)).not.toContain('hf_')
  })

  it('is checked as pasted, and kept under its own name in secrets', () => {
    expect(HF_KEY_SECRET).toBe('speech:huggingface')
    expect(cleanHuggingFaceKey(`  ${KEY}\n`)).toBe(KEY)
    expect(cleanHuggingFaceKey('   ')).toBe('')
    expect(() => cleanHuggingFaceKey('hf_abc')).toThrow(/doesn’t look like a Hugging Face key/)
    expect(() => cleanHuggingFaceKey('hf_abc def ghi jkl')).toThrow(/doesn’t look like a Hugging Face key/)
  })
})
