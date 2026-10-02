// Dictation (milestone 4, "Read aloud and dictation"): hold the key Adam picks to talk, and what he said
// is typed where the cursor is (the scene, a scene card, the chat, the Quick start box or any text
// field); a microphone button in Ask the world and the Quick start box; picking and testing the
// microphone. Owned by the Dictation part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Audio is recorded in the window (an AudioWorklet), sent to the speech server through the main process
// and never saved. Other parts put a microphone button by a text box with <MicButton>
// (src/renderer/src/features/dictation/MicButton.tsx).

/** The rate dictation records at: 16 kHz mono, what the speech server's dictation models take. */
export const DICTATION_SAMPLE_RATE = 16000

/** The longest recording, in seconds ("about four minutes"); a recording stops there and is typed in. */
export const DICTATION_MAX_SECONDS = 240

/** What the speech server made of a recording. */
export interface DictatedText {
  /** What was said, tidied ("um", "uh" and stutters such as "the the" taken out); '' when nothing was heard. */
  text: string
}

export interface DictationApi {
  /**
   * Writes down what was said in a recording (a 16 kHz mono WAV of at most DICTATION_MAX_SECONDS, made in
   * the window) with the speech server's dictation model. The audio is passed straight on and never saved.
   * Errors are plain words with the next step: codes 'speech-not-running', 'dictation-not-ready' (no
   * dictation model loaded), 'dictation-too-long' and 'dictation-failed'.
   */
  transcribeDictation(wav: Uint8Array): Promise<DictatedText>
}

export interface DictationEvents {
  // Dictation has no events of its own: whether it can be used is SpeechStatus.dictationReady ('speech:status').
}
