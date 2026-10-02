// Milestone 4: the handlers for src/shared/contracts/speech.ts (the Speech engine part owns both files).
// The work is done in src/main/speech/*; this file connects it to the settings and the window.
import type { Handlers } from './index'
import type { SpeechApi } from '@shared/contracts/speech'
import {
  cancelSpeechDownload,
  checkSpeech,
  dismissSpeechDownload,
  downloadSpeech,
  getSpeechStatus,
  getSpeechStorage,
  installPython,
  removeSpeechDownloads,
  setDictationEngine,
  setHuggingFaceKey,
  setSpeechServerUrl,
  setSpeechStartWithApp,
  showSpeechFolder,
  undoRemoveHuggingFaceKey,
  undoRemoveSpeechDownloads
} from '../speech'

export const speechHandlers: Handlers<keyof SpeechApi> = {
  getSpeechStatus: () => getSpeechStatus(),
  checkSpeech: () => checkSpeech(),
  setSpeechStartWithApp: (on) => setSpeechStartWithApp(on === true),
  setSpeechServerUrl: (url) => setSpeechServerUrl(String(url ?? '')),
  setDictationEngine: (engine) => setDictationEngine(engine),
  downloadSpeech: (kind) => downloadSpeech(kind),
  cancelSpeechDownload: () => cancelSpeechDownload(),
  dismissSpeechDownload: () => dismissSpeechDownload(),
  installPython: () => installPython(),
  setHuggingFaceKey: (key) => setHuggingFaceKey(typeof key === 'string' ? key : null),
  undoRemoveHuggingFaceKey: () => undoRemoveHuggingFaceKey(),
  getSpeechStorage: () => getSpeechStorage(),
  showSpeechFolder: () => showSpeechFolder(),
  removeSpeechDownloads: () => removeSpeechDownloads(),
  undoRemoveSpeechDownloads: () => undoRemoveSpeechDownloads()
}
