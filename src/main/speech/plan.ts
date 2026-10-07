// Adapted from mcreader-v2, src/server/speech/install.ts and tts/tools/install_engine.py (the steps, the
// pins and the order) (Adam's rule, 2 October 2026: only speech code is reused).
//
// The steps of each download, as program + argument list: never a shell command line, and nothing Adam
// types (the Hugging Face key goes in the one step that needs it, as an environment variable). Each step
// is safe to run again, so Try again simply starts the download over. Pure: tests read the plans.
import type { DictationModel, SpeechDownloadKind } from '@shared/contracts/speech'
import { join } from 'node:path'
import { PYTHON_PAGE } from './output'
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
  /** Where to get it by hand instead, linked when the step fails (python.org, for Python's installer). */
  byHand?: string
}

export interface PlanInput {
  paths: SpeechPaths
  platform: NodeJS.Platform
  /** The Python an environment is made with (its full path), when one has to be made. */
  basePython: string | null
  /** The server's environment is there and its Python runs (false also sets it up afresh: a repair). */
  serverVenv: boolean
  /** Breeze's environment is there, in AI Write's own copy (false also sets it up afresh). */
  breezeVenv: boolean
  /** The sound effects' environment is there (false also sets it up afresh). */
  soundVenv?: boolean
  /** The Hugging Face key, when one is saved. Only the voices' and the sound effects' weights steps get it. */
  hfKey: string | null
  /** The dictation models downloaded: their engines live in the server's environment, so setting it up afresh puts them back. */
  dictation?: DictationModel[]
}

/** github.com/breezeblue-ai/breeze-tts was tested on this PyTorch; the CUDA 12.8 build covers NVIDIA cards from the RTX 20s to the 50s. */
export const TORCH = ['torch==2.9.1', 'torchaudio==2.9.1']
export const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
/** Breeze's own requirements, less its test tools (MCreader's list). */
export const BREEZE_PACKAGES = ['qwen-tts==0.1.1', 'transformers==4.57.3', 'numpy>=2.0', 'soundfile>=0.13', 'librosa', 'huggingface_hub']
/** The sound effects' PyTorch: the voices' own, with the torchvision built for it (diffusers imports it). */
export const SOUND_TORCH = [...TORCH, 'torchvision==0.24.1']
/**
 * What runs Stable Audio Open and CLAP, at the versions tested together on Python 3.13 with that PyTorch. Not
 * stable-audio-tools: its own pins would replace the CUDA build of PyTorch with the plain one.
 */
export const SOUND_PACKAGES = [
  'diffusers==0.40.0',
  'transformers==5.18.0',
  'accelerate==1.15.0',
  'huggingface_hub==1.33.0',
  'safetensors==0.8.0',
  'sentencepiece==0.2.2',
  'einops==0.8.2',
  'soundfile==0.14.0',
  // Stable Audio Open's scheduler (diffusers' CosineDPMSolverMultistepScheduler) exists only with it.
  'torchsde==0.2.6'
]
/** The dictation engines, as Poor Man's Holodeck installs them. */
export const DICTATION_PACKAGES: Record<'parakeet' | 'whisper', string[]> = {
  parakeet: ['sherpa-onnx>=1.10'],
  whisper: ['faster-whisper>=1.0', 'huggingface_hub']
}

const PIP = ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', '--no-warn-script-location']

const TRY_AGAIN = 'Check the internet connection, then Try again.'

/**
 * The variables every step runs with: unbuffered UTF-8 output, and pip's, Python's and Hugging Face's own files
 * kept in the speech folder's cache (never a key saved elsewhere on this computer: only the weights step gets one).
 */
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
    // The voices' weights step has its own (models/hf, where the server reads them).
    HF_HOME: join(paths.cache, 'hf'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_DISABLE_PROGRESS_BARS: '1',
    // Hugging Face's newer downloader keeps a chunk cache of its own; the files are only fetched once.
    HF_XET_CHUNK_CACHE_SIZE_BYTES: '0',
    TMP: tmp,
    TEMP: tmp,
    TMPDIR: tmp
  }
}

/**
 * The variables a step (or the server) must never inherit from AI Write's own environment: they would point
 * Python, pip or Hugging Face somewhere else (the weights into another folder, say), or keep it offline.
 */
export const DROP_ENV = [
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'VIRTUAL_ENV',
  'PIP_USER',
  'PIP_TARGET',
  'PIP_PREFIX',
  'HF_TOKEN',
  'HUGGING_FACE_HUB_TOKEN',
  'HF_TOKEN_PATH',
  'HF_HOME',
  'HF_HUB_CACHE',
  'HUGGINGFACE_HUB_CACHE',
  'TRANSFORMERS_CACHE',
  'HF_HUB_OFFLINE',
  'TRANSFORMERS_OFFLINE',
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

/** Roughly how much each dictation model's engine downloads into the server's environment. */
const DICTATION_BYTES: Record<DictationModel, number> = { parakeet: 40e6, whisper: 120e6 }

/** The server itself: its environment and packages (about 150 MB with Python's own), with the engines of the dictation models downloaded. */
function serverPlan(i: PlanInput): Step[] {
  const { paths } = i
  const dictation = i.serverVenv ? [] : (i.dictation ?? [])
  const engines = dictation.flatMap((m) => DICTATION_PACKAGES[m])
  const steps: Step[] = []
  if (!i.serverVenv) steps.push(venvStep('venv', 'Setting up Python for the speech engine', i.basePython, paths.venv))
  steps.push(pipUpgrade(paths.python))
  steps.push({
    id: 'packages',
    label: 'Downloading the speech engine',
    command: paths.python,
    args: [...PIP, '--progress-bar', 'raw', '-r', join(paths.source, 'requirements.txt'), ...engines],
    progress: 'files',
    expect: 40e6 + dictation.reduce((n, m) => n + DICTATION_BYTES[m], 0),
    fails: `The speech engine didn’t finish downloading. ${TRY_AGAIN}`
  })
  steps.push({
    id: 'check',
    label: 'Checking the speech engine',
    ...tool(paths, paths.python, 'check-server'),
    progress: 'whole',
    // Try again after this step fails sets the environment up afresh (index.ts).
    fails: 'The speech engine didn’t install properly. Try again to set it up afresh; the voices are kept.'
  })
  return steps
}

/**
 * Breeze TTS 2 in its own environment, its code and its weights: about 12 GB in all. Always into AI
 * Write's own speech folder.
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
    // PyTorch, for the graphics card: a name Adam needn't know.
    label: 'Downloading the voice engine’s graphics card part',
    command: python,
    // There is no CUDA build for the Mac; there it is PyTorch's own (the voices are far too slow without NVIDIA anyway).
    args: [...PIP, '--progress-bar', 'raw', ...TORCH, ...(i.platform === 'darwin' ? [] : ['--index-url', TORCH_INDEX])],
    progress: 'files',
    expect: 3.2e9,
    fails: `The voice engine’s graphics card part didn’t finish downloading. ${TRY_AGAIN}`
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
      label: 'Checking the graphics card part',
      ...tool(paths, python, 'breeze-torch'),
      progress: 'files',
      fails: `The voice engine’s graphics card part couldn’t be put in place. ${TRY_AGAIN}`
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
    // Leaves the mark that says AI Write's own copy is complete (models/breeze/.ready).
    ...tool(paths, python, 'breeze-check', ['--root', root]),
    progress: 'whole',
    // Try again after this step fails sets the voices' environment up afresh (index.ts).
    fails: 'The voice engine didn’t install properly. Try again to set it up afresh; the voices already downloaded are kept.'
  })
  return steps
}

/**
 * The sound effects (Stable Audio Open, with CLAP to pick the best take) in their own environment: about 9 GB to
 * download, about 12 GB on disk. Always into AI Write's own speech folder.
 */
function soundsPlan(i: PlanInput): Step[] {
  const { paths } = i
  const root = paths.home
  const venv = join(root, 'venvs', 'sound')
  const python = venvPython(venv, i.platform)
  const steps: Step[] = []
  if (!i.soundVenv) steps.push(venvStep('venv', 'Setting up Python for the sound effects', i.basePython, venv))
  steps.push(pipUpgrade(python))
  steps.push({
    id: 'torch',
    label: 'Downloading the sound effects’ graphics card part',
    command: python,
    args: [...PIP, '--progress-bar', 'raw', ...SOUND_TORCH, ...(i.platform === 'darwin' ? [] : ['--index-url', TORCH_INDEX])],
    progress: 'files',
    expect: 3.3e9,
    fails: `The sound effects’ graphics card part didn’t finish downloading. ${TRY_AGAIN}`
  })
  steps.push({
    id: 'packages',
    label: 'Downloading the rest of the sound effects engine',
    command: python,
    args: [...PIP, '--progress-bar', 'raw', ...SOUND_PACKAGES],
    progress: 'files',
    expect: 130e6,
    fails: `The sound effects engine didn’t finish downloading. ${TRY_AGAIN}`
  })
  if (i.platform !== 'darwin') {
    steps.push({
      id: 'torch-check',
      label: 'Checking the graphics card part',
      ...tool(paths, python, 'sound-torch'),
      progress: 'files',
      fails: `The sound effects’ graphics card part couldn’t be put in place. ${TRY_AGAIN}`
    })
  }
  steps.push({
    id: 'weights',
    label: 'Downloading the sound effects model',
    ...tool(paths, python, 'sound-weights', ['--root', root]),
    env: { HF_HOME: join(root, 'models', 'hf'), ...(i.hfKey ? { HF_TOKEN: i.hfKey } : {}) },
    progress: 'whole',
    fails: 'The sound effects didn’t finish downloading. Check the internet connection and that there’s about 12 GB free, then Try again.'
  })
  steps.push({
    id: 'check',
    label: 'Checking the sound effects',
    // Leaves the mark that says they are complete (models/sound/.ready).
    ...tool(paths, python, 'sound-check', ['--root', root]),
    progress: 'whole',
    // Try again after this step fails sets their environment up afresh (index.ts).
    fails: 'The sound effects didn’t install properly. Try again to set them up afresh; what is already downloaded is kept.'
  })
  return steps
}

/**
 * The studio voices (real voices recorded in a studio, from the EARS dataset, with their acted feelings) and the word
 * check's listener, in the voices' environment: about 3.7 GB to download, about 2 GB on disk. Always into AI Write's own
 * speech folder, fetched from where they are published (never copied from another app).
 */
function studioPlan(i: PlanInput): Step[] {
  const { paths } = i
  const root = paths.home
  const python = venvPython(join(root, 'venvs', 'breeze'), i.platform)
  return [
    {
      id: 'voices',
      label: 'Downloading the studio voices',
      ...tool(paths, python, 'studio-voices', ['--root', root]),
      progress: 'whole',
      fails: 'The studio voices didn’t finish downloading. Check the internet connection and that there’s about 4 GB free, then Try again.'
    },
    {
      id: 'listener',
      label: 'Downloading the word check',
      ...tool(paths, python, 'check-model', ['--root', root]),
      env: { HF_HOME: join(root, 'models', 'hf') },
      progress: 'whole',
      fails: `The word check didn’t finish downloading. ${TRY_AGAIN}`
    },
    {
      id: 'check',
      label: 'Checking the studio voices',
      // Leaves the mark that says they are complete (voices/library/.ready).
      ...tool(paths, python, 'studio-check', ['--root', root]),
      progress: 'whole',
      fails: 'The studio voices didn’t download properly. Try again; those already downloaded are kept.'
    }
  ]
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
  if (kind === 'sounds') return soundsPlan(input)
  if (kind === 'studio') return studioPlan(input)
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
    fails: 'Windows’ installer couldn’t install Python. Try again, or install Python 3.13 from python.org.',
    byHand: PYTHON_PAGE
  }
}

/** What each download is called in Settings ("Downloading the voices..."). */
export const DOWNLOAD_NAMES: Record<SpeechDownloadKind, string> = {
  server: 'the speech engine',
  voices: 'the voices',
  parakeet: 'Parakeet',
  whisper: 'Whisper',
  sounds: 'the sound effects',
  studio: 'the studio voices'
}
