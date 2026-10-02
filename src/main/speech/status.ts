// What Settings shows about the speech engine, worked out from what the server says about itself
// (GET /v1/health: its engines, the device, the dictation models) and what AI Write knows (downloads,
// whether it starts the server). Pure.
import type { DictationModel, SpeechDownload, SpeechDownloadKind, SpeechLoadProblem, SpeechStatus } from '@shared/contracts/speech'

/** The parts of the server's /v1/health answer AI Write uses. */
export interface Health {
  /** 'aiwrite-speech' for AI Write's own server; MCreader's says nothing here. */
  service: string
  /** "CUDA · <card>" or "CPU", as the server says it. */
  device: string
  /** `loadError`: why the voices couldn't be loaded the last time they were asked for ('' since they last loaded). */
  voices: { ready: boolean; loaded: boolean; loadError?: string }
  /** null when the server has no dictation (MCreader's). `loadErrors`: each model's, as for the voices. */
  dictation: {
    engine: 'none' | DictationModel
    loaded: DictationModel | null
    parakeet: boolean
    whisper: boolean
    loadErrors?: Partial<Record<DictationModel, string>>
  } | null
}

const isModel = (v: unknown): v is DictationModel => v === 'parakeet' || v === 'whisper'

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Reads /v1/health's answer; null if it isn't one. */
export function readHealth(json: unknown): Health | null {
  if (!json || typeof json !== 'object') return null
  const h = json as Record<string, unknown>
  if (h.ok === false) return null
  const engines = Array.isArray(h.engines) ? (h.engines as Record<string, unknown>[]) : []
  const breeze = engines.find((e) => e && typeof e === 'object' && String(e.id ?? '').startsWith('breeze'))
  let dictation: Health['dictation'] = null
  if (h.dictation && typeof h.dictation === 'object') {
    const d = h.dictation as Record<string, unknown>
    const models = Array.isArray(d.models) ? (d.models as Record<string, unknown>[]) : []
    const ready = (id: DictationModel): boolean => models.some((m) => m && m.id === id && m.ready === true)
    const loadError = (id: DictationModel): string => text(models.find((m) => m && m.id === id)?.loadError)
    dictation = {
      engine: isModel(d.engine) ? d.engine : 'none',
      loaded: isModel(d.loaded) ? d.loaded : null,
      parakeet: ready('parakeet'),
      whisper: ready('whisper'),
      loadErrors: { parakeet: loadError('parakeet'), whisper: loadError('whisper') }
    }
  }
  return {
    service: typeof h.service === 'string' ? h.service : '',
    device: typeof h.device === 'string' ? h.device : '',
    voices: { ready: breeze?.ready === true, loaded: breeze?.loaded === true, loadError: text(breeze?.loadError) },
    dictation
  }
}

/** The device as Settings says it: the graphics card's name, or Processor. */
export function deviceName(label: string): string {
  const s = label.trim()
  if (!s) return ''
  if (/^cpu$/i.test(s) || /processor/i.test(s)) return 'Processor'
  const card = s.replace(/^cuda\s*[·:-]?\s*/i, '').trim()
  return card || 'Graphics card'
}

export interface StatusParts {
  /** AI Write starts the server ("Start with AI Write" is on). */
  managed: boolean
  /** A start is under way (or the server's first download, which starts it after). */
  starting: boolean
  health: Health | null
  problem: string
  /** The fix for `problem` is downloading the speech engine again. */
  repair: boolean
  /** The dictation model picked in Settings (settings.speech.dictationEngine). */
  picked: 'none' | DictationModel
  installed: SpeechStatus['installed']
  nvidia: string | null
  mcreader: string | null
  download: SpeechDownload | null
  queued: SpeechDownloadKind[]
  hfKey: boolean
  folder: string
  address: string
}

export function buildStatus(p: StatusParts): SpeechStatus {
  const h = p.health
  const dictation = h?.dictation ?? null
  // The model picked in Settings; with none picked there, the one a server AI Write didn't start chose for itself.
  const chosen = p.picked !== 'none' ? p.picked : dictation && dictation.engine !== 'none' ? dictation.engine : null
  const problem = h || p.starting ? '' : p.problem
  // A model that failed to load stays ready (the next use tries again); Settings says why, until it loads.
  const voicesError = h?.voices.ready && !h.voices.loaded ? (h.voices.loadError ?? '') : ''
  const dictationError =
    chosen && dictation && dictation.engine === chosen && dictation[chosen] && dictation.loaded !== chosen
      ? (dictation.loadErrors?.[chosen] ?? '')
      : ''
  return {
    server: h ? 'connected' : p.starting ? 'starting' : 'not-running',
    voicesReady: !!h?.voices.ready,
    // The server runs that model and has it downloaded: dictating works now (it loads on first use). Another
    // model it still holds (Adam picked a new one that is downloading) doesn't count.
    dictationReady: !!(chosen && dictation && dictation.engine === chosen && dictation[chosen]),
    managed: p.managed,
    problem,
    repair: !!problem && p.repair,
    installed: p.installed,
    loaded: { voices: !!h?.voices.loaded, dictation: dictation?.loaded ?? null },
    loadProblems: {
      voices: voicesError ? voicesLoadProblem(voicesError, p.installed.voices) : null,
      dictation: chosen && dictationError ? dictationLoadProblem(dictationError, chosen, p.installed[chosen]) : null
    },
    device: h ? deviceName(h.device) : '',
    nvidia: p.nvidia,
    mcreader: p.mcreader ? { folder: p.mcreader } : null,
    download: p.download,
    queued: p.queued,
    hfKey: p.hfKey,
    folder: p.folder,
    address: p.address
  }
}

/** Downloading the speech engine again fixes it (Settings' button says so): its own files, never the voices. */
export const DOWNLOAD_AGAIN = 'download it again below (about 150 MB); the voices are kept'

/** A problem starting the server, in plain words, and whether downloading it again is the fix. */
export interface StartProblem {
  text: string
  repair: boolean
}

/** Plain words for a server that stopped while starting, from the last lines of its log. */
export function startProblem(logTail: string, port: number): StartProblem {
  if (/address already in use|only one usage of each socket address|Errno 98|Errno 48|WinError 10048/i.test(logTail)) {
    return {
      text: `Another program is using port ${port}. Change the server address in More to another port (for example http://127.0.0.1:${port + 1}/v1), then Check.`,
      repair: false
    }
  }
  if (/ModuleNotFoundError|No module named|ImportError|DLL load failed/i.test(logTail)) {
    return { text: 'Part of the speech engine is missing. Download it again below (about 150 MB); the voices are kept.', repair: true }
  }
  if (/MemoryError|out of memory/i.test(logTail))
    return { text: 'The computer ran out of memory starting the speech engine. Close other programs, then Check.', repair: false }
  return { text: `The speech engine stopped while starting. Check again; if it keeps happening, ${DOWNLOAD_AGAIN}.`, repair: true }
}

const OUT_OF_MEMORY = /out of memory|OutOfMemoryError|CUDA_ERROR_OUT_OF_MEMORY|MemoryError|not enough memory|bad_alloc|Unable to allocate/i
const CARD_TOO_OLD = /no kernel image|not compatible with the current PyTorch|sm_\d+ is not compatible/i
const CARD_DRIVER =
  /CUDA driver|driver version is insufficient|NVIDIA driver|cudaGetDeviceCount|CUDA initiali[sz]ation|CUDA unknown error|nvcuda\.dll|libcuda/i

/**
 * Plain words for the voices failing to load, from the server's reason (/v1/health), with the fix: AI Write's
 * own copy is downloaded again to repair it (their environment set up afresh, the voices themselves kept).
 */
export function voicesLoadProblem(reason: string, copy: 'own' | 'mcreader' | null): SpeechLoadProblem {
  if (OUT_OF_MEMORY.test(reason)) {
    return {
      text: 'The graphics card ran out of memory loading the voices. Close other programs that use it (MCreader v2, games or other AI apps), then try again.',
      repair: false
    }
  }
  if (CARD_TOO_OLD.test(reason)) {
    // The CUDA 12.8 build the voices use (plan.ts) runs on the RTX 20s and newer.
    return { text: 'This graphics card is too old for the voices: they need an NVIDIA RTX card (the 20 series or newer).', repair: false }
  }
  if (CARD_DRIVER.test(reason)) {
    return {
      text: 'The voices couldn’t use the graphics card. Update its NVIDIA driver and restart the computer, then try again.',
      repair: false
    }
  }
  if (copy === 'own') {
    return {
      text: 'The voice engine couldn’t load the voices. Download it again below to set it up afresh (about 4 GB); the voices already downloaded are kept.',
      repair: true
    }
  }
  if (copy === 'mcreader') {
    return {
      text: 'MCreader v2’s copy of the voices couldn’t be loaded. Try again; if it keeps happening, download AI Write’s own copy below.',
      repair: false
    }
  }
  return { text: 'The speech server couldn’t load the voices. Restart it, then try again.', repair: false }
}

/** Plain words for a dictation model failing to load, with the fix: downloading it again, or the other model. */
export function dictationLoadProblem(reason: string, model: DictationModel, downloaded: boolean): SpeechLoadProblem {
  const name = model === 'parakeet' ? 'Parakeet' : 'Whisper'
  const other = model === 'parakeet' ? 'Whisper' : 'Parakeet'
  if (OUT_OF_MEMORY.test(reason))
    return { text: `The computer ran out of memory loading ${name}. Close other programs, then try again.`, repair: false }
  if (downloaded) return { text: `${name} couldn’t be loaded. Download it again below to repair it, or pick ${other}.`, repair: true }
  return { text: `The speech server couldn’t load ${name}. Pick ${other}, or restart the speech server.`, repair: false }
}
