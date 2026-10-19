# Worlds saved by the released app

Worlds and settings saved by **AI Write 0.8.1** (commit `e3bb8dc1`, the release before the AI overhaul), for
`tests/unit/worldUpgrade.test.ts` (an older world opens in this version with nothing lost) and
`tests/unit/settingsCarry.test.ts` (older settings load with every value kept). Invented stories only: never a real
world, never a key.

| File | What it is |
| --- | --- |
| `sample-0.8.1.db.gz` | The sample world (Gullhaven) as 0.8.1's "Try the sample world" made it, opened once, with a little of what the sample lacks added through 0.8.1's own functions: three pins, an answer, an act, an issue, a suppression, a story brief, writing-preference overrides and a scene in Recently deleted. Layout 4. |
| `trap-story-0.8.1.db.gz` | The trap harness's invented story (`tests/traps/story-v3.json`): 30 scenes, 47,405 words, read by 0.8.1's memory with the fake provider, with 180 draft records, memory runs, summaries at every level, chapter snapshots and where things stand (`continuity` in meta). Layout 4. |
| `../settings/settings-0.8.1.json` | 0.8.1's settings.json with every value changed from its default (once on the Classic look with panels, once on the New look's desk) and writing-preferences.json, each as saved and as 0.8.1 read it back. The library folder is `<LIBRARY>`. |

Both worlds are gzipped (36 KB and 866 KB; 0.4 MB and 5.2 MB unpacked); the tests unpack them into a throwaway library.
Between them every table of layout 4 has rows.

## Making them again

From a checkout of the release (here `AIWriter-ov-released`, detached at `e3bb8dc1`; never commit there):

1. The trap story: `npm run traps -- --fake --samples 1 --out <folder>` in the release checkout (25 seconds, no key, no
   cost). It saves `world-before-chain.db` in `<folder>`; `trap-story-0.8.1.db.gz` is that file gzipped.
2. The sample world and settings, from this checkout, with the release's code:
   `REL_ROOT=<release checkout> MAKER_OUT=<folder> npx vitest run -c tests/fixtures/worlds/make/vitest.make.config.mjs`
   writes `sample-<version>.db.gz` and `settings-<version>.json` (`make/make.run.ts`). It imports the release's code,
   not this checkout's, through `REL_ROOT`.

When a later release changes the layout or the settings, add that release's files beside these rather than replacing
them: every older world must keep opening.
