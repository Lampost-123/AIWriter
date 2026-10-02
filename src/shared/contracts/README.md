# Milestone 3 contracts

Each part of the milestone 3 build owns one file here: its API methods (an interface that `AppApi`
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
