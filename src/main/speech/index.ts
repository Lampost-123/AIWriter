// The speech engine (milestone 4): the local speech server for reading aloud and dictation. Owned by the
// Speech engine part; see src/shared/contracts/speech.ts and docs/ARCHITECTURE.md, "Milestone 4".

/** Called once at startup (src/main/index.ts): starts the speech server when "Start with AI Write" is on. Groundwork stand-in. */
export function initSpeech(): void {}

/** Called as the app quits, after the world has closed: stops the speech server it started. Groundwork stand-in. */
export function stopSpeech(): void {}
