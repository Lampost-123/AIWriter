# Milestone 3 and 4 contracts

Each part of the milestone 3 and milestone 4 builds owns one file here: its API methods (an interface that `AppApi`
extends), its events (an interface that `AppEvents` extends) and its own types. A part changes only
its own file; anything another part needs from it is already declared, so parts can build side by
side. Like the rest of `src/shared`, changes are additive once merged.

| File | Part |
|---|---|
| builder.ts | Character builder and the lighter builders |
| entryViews.ts | Codex and entry pages |
| worldViews.ts | Timeline, relationship map, plot threads board |
| manuscript.ts | Inside the manuscript: names, hover cards, Cast tab, Add to memory |
| search.ts | Search, command palette and the shortcuts list |
| stories.ts | Story screens: New story dialog, story settings |
| storyFlows.ts | The automatic story flows (time gap, prequel starting cast, "When did these happen?") |

Milestone 4:

| File | Part |
|---|---|
| tasks.ts | Groundwork: the shared runner for AI calls that aren't drafts (src/main/ai/tasks.ts) |
| history.ts | Drafts and history: snapshots, compare and restore, the Drafts tab |
| variants.ts | Variants |
| beats.ts | Beat by beat |
| edits.ts | The AI tools for selected words, tracked changes, Continue |
| ask.ts | Ask the world |
| outline.ts | The outline helper, acts in the binder, next scene ideas |
| speech.ts | The speech engine: the local speech server, its downloads and status |
| readAloud.ts | Reading aloud: Listen, voices, who says each line, calibration |
| dictation.ts | Dictation: hold to talk, the microphone button, the microphone test |
| worldBuilder.ts | Build the world from a summary (the World builder) |
