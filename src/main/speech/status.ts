// What Settings shows about the speech engine, worked out from what the server says about itself
// (GET /v1/health: its engines, the device, the dictation models) and what AI Write knows (downloads,
// whether it starts the server). Pure.
import type { DictationModel, SpeechDownload, SpeechDownloadKind, SpeechStatus } from '@shared/contracts/speech'

/** The parts of the server's /v1/health answer AI Write uses. */
export interface Health {
  /** 'aiwrite-speech' for AI Write's own server; MCreader's says nothing here. */
  service: string
  /** "CUDA · <card>" or "CPU", as the server says it. */
  device: string
  voices: { ready: boolean; loaded: boolean }
  /** null when the server has no dictation (MCreader's). */
  dictation: { engine: 'none' | DictationModel; loaded: DictationModel | null; parakeet: boolean; whisper: boolean } | null
}

const isModel = (v: unknown): v is DictationModel => v === 'parakeet' || v === 'whisper'

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
    dictation = {
      engine: isModel(d.engine) ? d.engine : 'none',
      loaded: isModel(d.loaded) ? d.loaded : null,
      parakeet: ready('parakeet'),
      whisper: ready('whisper')
    }
  }
  return {
    service: typeof h.service === 'string' ? h.service : '',
    device: typeof h.device === 'string' ? h.device : '',
    voices: { ready: breeze?.ready === true, loaded: breeze?.loaded === true },
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
