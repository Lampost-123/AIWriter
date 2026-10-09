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
| phone.ts | The phone on the same Wi-Fi: another window, with the AI and the voices still on this computer |
| readAloud.ts | Reading aloud: Listen, voices, who says each line, calibration |
| dictation.ts | Dictation: hold to talk, the microphone button, the microphone test |
| worldBuilder.ts | Build the world from a summary (the World builder) |

Milestone 5: checks.ts (the consistency checker, three parts).

Milestone 6:

| File | Part |
|---|---|
| transfer.ts | World files and export: the .aiwrite file, Make a copy, manuscript and series bible export |
| importing.ts | Manuscript import and the import catch-up |
| usage.ts | The usage and cost page, the monthly limit |
| setup.ts | First-run setup and the sample world |
| look.ts | Themes finished (accent colour, reduced motion) and focus mode |

After milestone 6: recipes.ts (Story recipes: the recipe library, making a recipe, a new story from one).
Writing by hand: find.ts (find and replace across the story; finding in the open scene is the window's own).
Writing by hand: spelling.ts (spell check in the writer's spelling, the world's names, synonyms on right-click).
The scene and chapter critic: critique.ts (craft feedback on a scene or a chapter, the Critique tab).
