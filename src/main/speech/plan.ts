// Adapted from mcreader-v2, src/server/speech/install.ts and tts/tools/install_engine.py (the steps, the
// pins and the order) (Adam's rule, 2 October 2026: only speech code is reused).
//
// The steps of each download, as program + argument list: never a shell command line, and nothing Adam
// types (the Hugging Face key goes in the one step that needs it, as an environment variable). Each step
// is safe to run again, so Try again simply starts the download over. Pure: tests read the plans.
import type { SpeechDownloadKind } from '@shared/contracts/speech'
import { join } from 'node:path'
import { venvPython, type SpeechPaths } from './paths'
import { wingetArgs } from './system'

export interface Step {
  /** Short and stable, for the log and the tests ('venv', 'torch', 'weights'...). */
  id: string
  /** What Settings shows, in plain words. */
  label: string
  command: string
  args: string[]
  /** Added to the step's environment, on top of the shared variables (stepEnv). */
  env?: Record<string, string>
  /** How its progress reads: pip downloads several files, added up ('files'); other steps report the whole ('whole'). */
  progress: 'files' | 'whole'
  /** Roughly how many bytes a 'files' step downloads, so one bar covers them all. */
  expect?: number
  /** What Adam reads if it fails without saying why. */
  fails: string
}

export interface PlanInput {
  paths: SpeechPaths
  platform: NodeJS.Platform
  /** The Python an environment is made with (its full path), when one has to be made. */
  basePython: string | null
  /** The server's environment is there and its Python runs. */
  serverVenv: boolean
  /** Breeze's environment is there, in AI Write's own copy. */
  breezeVenv: boolean
  /** The Hugging Face key, when one is saved. Only the voices' weights step gets it. */
  hfKey: string | null
}

/** github.com/breezeblue-ai/breeze-tts was tested on this PyTorch; the CUDA 12.8 build covers NVIDIA cards from the RTX 20s to the 50s. */
export const TORCH = ['torch==2.9.1', 'torchaudio==2.9.1']
export const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
/** Breeze's own requirements, less its test tools (MCreader's list). */
export const BREEZE_PACKAGES = ['qwen-tts==0.1.1', 'transformers==4.57.3', 'numpy>=2.0', 'soundfile>=0.13', 'librosa', 'huggingface_hub']
/** The dictation engines, as Poor Man's Holodeck installs them. */
export const DICTATION_PACKAGES: Record<'parakeet' | 'whisper', string[]> = {
  parakeet: ['sherpa-onnx>=1.10'],
  whisper: ['faster-whisper>=1.0', 'huggingface_hub']
}

const PIP = ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '--no-warn-script-location']

const TRY_AGAIN = 'Check the internet connection, then Try again.'

/** The variables every step runs with: unbuffered UTF-8 output, and pip's and Python's own files kept in the speech folder's cache. */
export function stepEnv(paths: SpeechPaths): Record<string, string> {
  const tmp = join(paths.cache, 'tmp')
  return {
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONPYCACHEPREFIX: join(paths.cache, 'pycache'),
    PIP_CACHE_DIR: join(paths.cache, 'pip'),
    PIP_NO_INPUT: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_DISABLE_PROGRESS_BARS: '1',
    // Hugging Face's newer downloader keeps a chunk cache of its own; the files are only fetched once.
    HF_XET_CHUNK_CACHE_SIZE_BYTES: '0',
    TMP: tmp,
    TEMP: tmp,
    TMPDIR: tmp
  }
}

/** The variables a step must never inherit from AI Write's own environment. */
export const DROP_ENV = [
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'VIRTUAL_ENV',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'ELECTRON_RUN_AS_NODE'
]

function venvStep(id: string, label: string, basePython: string | null, venv: string): Step {
  return {
    id,
    label,
    // Checked before the plan is made: without a Python the download stops at "Install Python".
    command: basePython ?? 'python',
    args: ['-m', 'venv', '--clear', venv],
    progress: 'whole',
    fails: 'Python couldn’t make an environment for the speech engine. Try again; if it keeps failing, install Python again.'
  }
}

const pipUpgrade = (python: string): Step => ({
  id: 'pip',
  label: 'Updating Python’s package installer',
  command: python,
  args: [...PIP, '--progress-bar', 'off', '--upgrade', 'pip'],
  progress: 'whole',
  fails: `Python’s package installer couldn’t be updated. ${TRY_AGAIN}`
})

const tool = (paths: SpeechPaths, python: string, step: string, extra: string[] = []): { command: string; args: string[] } => ({
  command: python,
  args: [join(paths.source, 'tools', 'install.py'), step, ...extra]
})

/** The server itself: its environment and packages (about 150 MB with Python's own). */
function serverPlan(i: PlanInput): Step[] {
  const { paths } = i
  const steps: Step[] = []
  if (!i.serverVenv) steps.push(venvStep('venv', 'Setting up Python for the speech engine', i.basePython, paths.venv))
  steps.push(pipUpgrade(paths.python))
  steps.push({
    id: 'packages',
    label: 'Downloading the speech engine',
    command: paths.python,
    args: [...PIP, '--progress-bar', 'raw', '-r', join(paths.source, 'requirements.txt')],
    progress: 'files',
    expect: 40e6,
    fails: `The speech engine didn’t finish downloading. ${TRY_AGAIN}`
  })
  steps.push({
    id: 'check',
    label: 'Checking the speech engine',
    ...tool(paths, paths.python, 'check-server'),
    progress: 'whole',
    fails: 'The speech engine didn’t install properly. Try again; if it keeps failing, remove the downloads in More and download it again.'
  })
  return steps
}

/**
 * Breeze TTS 2 in its own environment, its code and its weights: about 12 GB in all. Always into AI
 * Write's own speech folder: MCreader's copy is only ever used as it is, never downloaded into.
 */
function voicesPlan(i: PlanInput): Step[] {
  const { paths } = i
  const root = paths.home
  const breezeVenv = join(root, 'venvs', 'breeze')
  const python = venvPython(breezeVenv, i.platform)
  const steps: Step[] = []
  if (!i.breezeVenv) steps.push(venvStep('venv', 'Setting up Python for the voices', i.basePython, breezeVenv))
  steps.push(pipUpgrade(python))
  steps.push({
    id: 'torch',
    label: 'Downloading PyTorch for the graphics card',
    command: python,
    // There is no CUDA build for the Mac; there it is PyTorch's own (the voices are far too slow without NVIDIA anyway).
    args: [...PIP, '--progress-bar', 'raw', ...TORCH, ...(i.platform === 'darwin' ? [] : ['--index-url', TORCH_INDEX])],
    progress: 'files',
    expect: 3.2e9,
    fails: `PyTorch didn’t finish downloading. ${TRY_AGAIN}`
  })
  steps.push({
    id: 'packages',
    label: 'Downloading the rest of the voice engine',
    command: python,
    args: [...PIP, '--progress-bar', 'raw', ...BREEZE_PACKAGES],
    progress: 'files',
    expect: 400e6,
    fails: `The voice engine didn’t finish downloading. ${TRY_AGAIN}`
  })
  if (i.platform !== 'darwin') {
    steps.push({
      id: 'torch-check',
      label: 'Checking PyTorch',
      ...tool(paths, python, 'breeze-torch'),
      progress: 'files',
      fails: `PyTorch for the graphics card couldn’t be put in place. ${TRY_AGAIN}`
    })
  }
  steps.push({
    id: 'code',
    label: 'Downloading Breeze’s code',
    ...tool(paths, python, 'breeze-code', ['--root', root]),
    progress: 'whole',
    fails: `Breeze’s code didn’t download. ${TRY_AGAIN}`
  })
  steps.push({
    id: 'weights',
    label: 'Downloading the voices',
    ...tool(paths, python, 'breeze-weights', ['--root', root]),
    env: { HF_HOME: join(root, 'models', 'hf'), ...(i.hfKey ? { HF_TOKEN: i.hfKey } : {}) },
    progress: 'whole',
    fails: 'The voices didn’t finish downloading. Check the internet connection and that there’s about 12 GB free, then Try again.'
  })
  steps.push({
    id: 'check',
    label: 'Checking the voices',
    ...tool(paths, python, 'breeze-check'),
    progress: 'whole',
    fails: 'The voices didn’t install properly. Try again; if it keeps failing, remove the downloads in More and download them again.'
  })
  return steps
}

/** Parakeet or Whisper: its engine in the server's environment, then its English model. */
function dictationPlan(kind: 'parakeet' | 'whisper', i: PlanInput): Step[] {
  const { paths } = i
  const name = kind === 'parakeet' ? 'Parakeet' : 'Whisper'
  return [
    {
      id: 'packages',
      label: `Downloading ${name}’s engine`,
      command: paths.python,
      args: [...PIP, '--progress-bar', 'raw', ...DICTATION_PACKAGES[kind]],
      progress: 'files',
      expect: kind === 'parakeet' ? 40e6 : 120e6,
      fails: `${name} didn’t finish downloading. ${TRY_AGAIN}`
    },
    {
      id: 'model',
      label: kind === 'parakeet' ? 'Downloading Parakeet’s English model' : 'Downloading Whisper’s English model',
      ...tool(paths, paths.python, kind === 'parakeet' ? 'parakeet-model' : 'whisper-model', ['--home', paths.home]),
      progress: 'whole',
      fails: `${name} didn’t finish downloading. ${TRY_AGAIN}`
    },
    {
      id: 'check',
      label: `Checking ${name}`,
      ...tool(paths, paths.python, 'check-dictation', [kind]),
      progress: 'whole',
      fails: `${name} didn’t install properly. Try again.`
    }
  ]
}

/** Every step of a download, in order. */
export function planFor(kind: SpeechDownloadKind, input: PlanInput): Step[] {
  if (kind === 'server') return serverPlan(input)
  if (kind === 'voices') return voicesPlan(input)
  return dictationPlan(kind, input)
}

/** Installing Python itself with Windows' own installer (winget), before the server's download. */
export function pythonStep(winget: string): Step {
  return {
    id: 'python',
    label: 'Installing Python with Windows’ installer',
    command: winget,
    args: wingetArgs(),
    progress: 'whole',
    fails: 'Windows’ installer couldn’t install Python. Try again, or install Python 3.13 from python.org.'
  }
}

/** What each download is called in Settings ("Downloading the voices..."). */
export const DOWNLOAD_NAMES: Record<SpeechDownloadKind, string> = {
  server: 'the speech engine',
  voices: 'the voices',
  parakeet: 'Parakeet',
  whisper: 'Whisper'
}
