// The speech engine (milestone 4, "Read aloud and dictation"): the local speech server that speaks
// (Breeze TTS 2) and listens (Parakeet or Whisper), set up from Settings with no terminal: downloads,
// Python, starting it hidden with the app, its status. Owned by the Speech engine part. See
// docs/ARCHITECTURE.md, "Milestone 4". Reading aloud (readAloud.ts) and dictation (dictation.ts) use it.
//
// The server, its Python environments and models live in the app's user data folder (never in the app,
// git or backups) and listen on 127.0.0.1:8766. Settings › Read aloud and dictation can point at another
// speech server on this computer (loopback only).
/** What the badge in Settings says, and whether reading aloud and dictation can be used now. */
export interface SpeechStatus {
  /** The server answers ('connected'), is being started ('starting'), or isn't running ('not-running'). */
  server: 'connected' | 'starting' | 'not-running'
  /** Voices can be spoken now: Breeze is installed and the server answers. */
  voicesReady: boolean
  /** Dictation can be used now: a dictation model is installed and the server answers. */
  dictationReady: boolean
  // The Speech engine part adds the rest (the device, what is installed and loaded, downloads...).
}

export interface SpeechApi {
  /** Where the speech server stands now. */
  getSpeechStatus(): Promise<SpeechStatus>
  // The Speech engine part adds the rest here (downloads, start and stop, Check, the Hugging Face token...).
}

export interface SpeechEvents {
  /** The speech server's status changed (started, stopped, a download finished...). */
  'speech:status': SpeechStatus
  // The Speech engine part adds the rest here (download progress...).
}
