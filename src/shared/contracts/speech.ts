// The speech engine (milestone 4, "Read aloud and dictation"): the local speech server that speaks
// (Breeze TTS 2) and listens (Parakeet or Whisper), set up from Settings with no terminal: downloads,
// Python, starting it hidden with the app, its status. Owned by the Speech engine part. See
// docs/ARCHITECTURE.md, "Milestone 4". Reading aloud (readAloud.ts) and dictation (dictation.ts) use it.
//
// The server, its Python environments and models live in the app's user data folder (never in the app,
// git or backups) and listen on 127.0.0.1:8766. Settings › Read aloud and dictation can point at another
// speech server on this computer (loopback only).

/** Whether the speech server answers ('connected'), is being started ('starting'), or isn't running ('not-running'). */
export type SpeechServerState = 'connected' | 'starting' | 'not-running'

/** The two dictation models: Parakeet (sharper, about 1 GB) and Whisper (smaller). Both English only, on the processor. */
export type DictationModel = 'parakeet' | 'whisper'

/**
 * What can be downloaded: the server itself (with its Python environment), the voices (Breeze TTS 2), a dictation model,
 * or the sound effects model ('sounds': Stable Audio Open and CLAP, in their own environment; contracts/sounds.ts).
 */
export type SpeechDownloadKind = 'server' | 'voices' | DictationModel | 'sounds'

/** One download as Settings shows it: its step, a progress bar, the latest line of output, Cancel and Try again. */
export interface SpeechDownload {
  kind: SpeechDownloadKind
  /** 'running' while a step works; 'failed' and 'cancelled' wait for Try again (or Dismiss); 'done' shows briefly. */
  state: 'running' | 'failed' | 'cancelled' | 'done'
  /** The step in plain words ("Downloading the voice engine’s graphics card part"). */
  step: string
  /** Which step it is (from 1) of how many. */
  stepIndex: number
  stepCount: number
  /** How far the step is, 0 to 100, or null when it can't be told (the bar then shows it's busy). */
  percent: number | null
  /** How much has come so far ("1.2 GB of 3.1 GB"), when it's known. */
  amount: string
  /** The latest line of the step's output. */
  line: string
  /** What went wrong and how to fix it, in plain words ('' unless it failed). */
  error: string
  /**
   * A problem with a fix Settings offers: Python to install with one click ('python', Windows' own
   * installer), Python to install from its website ('python-manual'), a licence to accept on Hugging
   * Face before the voices can download ('licence', with the Hugging Face key box), or a Hugging Face
   * key it turned down ('key', with the box for a new one).
   */
  need: 'python' | 'python-manual' | 'licence' | 'key' | null
  /** The page that fixes it (Hugging Face's licence or keys page, or python.org); '' when there is none. */
  link: string
}

/** Why the voices, or a dictation model, couldn't be loaded the last time they were asked for. */
export interface SpeechLoadProblem {
  /** What went wrong and the fix, in plain words. */
  text: string
  /** Downloading it again is the fix: Settings offers it with one click (what is already downloaded is kept). */
  repair: boolean
}

/** What Settings shows about the speech engine, and whether reading aloud and dictation can be used now. */
export interface SpeechStatus {
  /** The server answers ('connected'), is being started ('starting'), or isn't running ('not-running'). */
  server: SpeechServerState
  /** Voices can be spoken now: Breeze is installed and the server answers. */
  voicesReady: boolean
  /**
   * Dictation can be used now: the chosen dictation model is installed and the server answers with it. With
   * none chosen in AI Write, the model a server AI Write didn't start has chosen for itself.
   */
  dictationReady: boolean
  /** Sound effects can be made now: the sound model is downloaded and the server answers. */
  soundsReady?: boolean
  /** AI Write starts and stops the server itself ("Start with AI Write" is on). */
  managed: boolean
  /** Why the server isn't running when it should be, in plain words with the fix; '' when nothing is wrong. */
  problem: string
  /**
   * The fix for `problem` is downloading the speech engine again (part of it is missing or broken): Settings
   * offers it with one click (downloadSpeech('server'); the voices and dictation models are kept).
   */
  repair: boolean
  /** What is downloaded on this computer, in AI Write's own speech folder (`voices` is 'own' once they are). */
  installed: { server: boolean; voices: 'own' | null; parakeet: boolean; whisper: boolean; sounds?: boolean }
  /** What the server holds in memory now (a model unused for five minutes is let go). */
  loaded: { voices: boolean; dictation: DictationModel | null; sounds?: boolean }
  /**
   * The voices, or the dictation model in use, failed to load the last time they were asked for (out of
   * memory, say), and why; null once they load. They stay ready: the next use tries again.
   */
  loadProblems: { voices: SpeechLoadProblem | null; dictation: SpeechLoadProblem | null; sounds?: SpeechLoadProblem | null }
  /** What the voices run on: the graphics card's name, or 'Processor'; '' while the server isn't answering. */
  device: string
  /** The NVIDIA graphics card on this computer ('' when there is none); null until it has been looked for. */
  nvidia: string | null
  /** That card's memory in MiB, as nvidia-smi gives it; null (or absent) when it isn't known. */
  nvidiaMemoryMb?: number | null
  /** That card's CUDA compute capability (7.5 for the RTX 20 series); null (or absent) when it isn't known. */
  nvidiaComputeCap?: number | null
  /** Free space, in bytes, on the disk the speech folder is on; null (or absent) when it isn't known. */
  freeSpace?: number | null
  /** The download running, or stopped on a problem or by Cancel; null when there's none to show. */
  download: SpeechDownload | null
  /** Downloads waiting for the one running to finish, in order. */
  queued: SpeechDownloadKind[]
  /** A Hugging Face key is saved (the key itself never leaves the main process). */
  hfKey: boolean
  /** The speech folder in AI Write's user data, where everything downloaded is kept. */
  folder: string
  /** The server's address in use (Settings' own when it's on this computer). */
  address: string
}

/** What the speech folder holds, for "Where things are kept". */
export interface SpeechStorage {
  folder: string
  /** Each part's size on disk, in bytes; 0 when it isn't downloaded. */
  parts: { kind: SpeechDownloadKind; bytes: number }[]
  total: number
}

export interface SpeechApi {
  /** Where the speech server stands now. */
  getSpeechStatus(): Promise<SpeechStatus>
  /** Check: asks the server again (and starts it when "Start with AI Write" is on and it isn't running). */
  checkSpeech(): Promise<SpeechStatus>
  /** "Start with AI Write": on starts the server (downloading it the first time); off stops it. */
  setSpeechStartWithApp(on: boolean): Promise<SpeechStatus>
  /** The server's address. Must be on this computer (localhost, 127.0.0.1 or ::1), or it is refused in plain words. */
  setSpeechServerUrl(url: string): Promise<SpeechStatus>
  /** The dictation model, remembered and loaded at start; picking one that isn't downloaded starts its download. */
  setDictationEngine(engine: 'none' | DictationModel): Promise<SpeechStatus>
  /**
   * Starts a download, or queues it behind the one running. Also Try again. The voices or a dictation model
   * asked for before the speech engine is downloaded download it first (and turn "Start with AI Write" on
   * when no other speech server answers). The speech engine asked for once it is downloaded is downloaded
   * again: its environment is set up afresh (the repair Settings offers), the voices and models are kept.
   * The same goes for the voices (AI Write's own copy: their environment is set up afresh, the voices
   * themselves kept) and a dictation model (fetched again, with the speech engine's environment set up
   * afresh), which Settings offers again when they couldn't be loaded (loadProblems).
   */
  downloadSpeech(kind: SpeechDownloadKind): Promise<SpeechStatus>
  /** Cancel: stops the download running (nothing half-made is kept as done) and the ones queued. */
  cancelSpeechDownload(): Promise<SpeechStatus>
  /** Hides a download that failed, was cancelled or finished. */
  dismissSpeechDownload(): Promise<SpeechStatus>
  /** Installs Python with Windows' own installer (winget), then carries on with the speech engine's download. */
  installPython(): Promise<SpeechStatus>
  /** Saves the Hugging Face key (kept like the AI keys), or removes it with null. Only the voices' and the sound effects' downloads use it. */
  setHuggingFaceKey(key: string | null): Promise<SpeechStatus>
  /** Undo for removing the Hugging Face key: puts it back, for a couple of minutes after (it never leaves the main process). */
  undoRemoveHuggingFaceKey(): Promise<SpeechStatus>
  /** How much each download takes on disk. */
  getSpeechStorage(): Promise<SpeechStorage>
  /** Opens the speech folder in the file manager. */
  showSpeechFolder(): Promise<void>
  /** Removes everything downloaded and turns "Start with AI Write" off. Undo puts it back. */
  removeSpeechDownloads(): Promise<SpeechStatus>
  /** Undo for removeSpeechDownloads, while the removed files are still kept aside. */
  undoRemoveSpeechDownloads(): Promise<SpeechStatus>
}

export interface SpeechEvents {
  /** The speech server's status changed (started, stopped, a download moved on or finished...). */
  'speech:status': SpeechStatus
}
