// Dictation (milestone 4, "Read aloud and dictation"): hold the key Adam picks to talk, and what he said
// is typed where the cursor is (the scene, a scene card, the chat, the Quick start box or any text
// field); a microphone button in Ask the world and the Quick start box; picking and testing the
// microphone. Owned by the Dictation part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Audio is recorded in the window (an AudioWorklet), sent to the speech server through the main process
// and never saved. Other parts put a microphone button by a text box with <MicButton>
// (src/renderer/src/features/dictation/MicButton.tsx).

export interface DictationApi {
  // The Dictation part adds its calls here.
}

export interface DictationEvents {
  // The Dictation part adds its events here.
}
