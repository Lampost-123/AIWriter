# Trap scores

Step 6 of the story memory plan: an invented story with continuity traps planted in it, and a harness that asks the
app to write at chosen points and scores, claim by claim, whether what it wrote keeps to the truth. Run it on main
and on each step's branch, with the same model, to see whether a step really helps.

It runs the app's own main-process code (settings, providers, world, memory keeper, briefing, drafting) in plain
Node, with a stand-in for Electron and a throwaway data folder, so it measures what Adam gets. It never touches
Adam's library, settings or keys, and it is never part of `npm test` or CI.

## Running it

```powershell
# Check the harness itself: fake provider, stand-in judge, no key, no cost. Not a score.
npm run traps -- --fake

# A real score of this checkout on DeepSeek Flash, through DeepSeek's own API.
npm run traps

# The same harness on another checkout's app code (it needs its own node_modules: npm ci there first)
npm run traps -- --root C:\Users\adox1\Documents\AIWriter-stage

# Step 3 (check and repair): found and used by itself, scored as written and after repair
npm run traps -- --root C:\Users\adox1\Documents\AIWriter-repair

# Side by side
npm run traps -- --compare traps-results\<one run> traps-results\<another run>
```

**The key** is read from `DEEPSEEK_API_KEY` only: from the terminal's environment, or, on Windows, from the user's
saved environment variables (set with `setx DEEPSEEK_API_KEY ...` or System Properties) when the terminal was opened
before it was set. It is never printed or written to the report. Without it a real run refuses to start.

**The provider** is DeepSeek, set up as the app's DeepSeek preset does it in Settings › Models: an OpenAI-compatible
provider at `https://api.deepseek.com/v1`. `--provider openrouter` uses OpenRouter instead, with its key from
`OPENROUTER_API_KEY`.

**The models**: with no `--writer`, the model whose id has "flash" in it in the provider's model list (the list costs
nothing; on OpenRouter, DeepSeek's own, never a `:free` variant) is the writer, the memory model and the judge. If
none is listed, the run stops before any paid call and lists the ids it found: pick one with `--writer <id>`.
`--memory <id>` and `--judge <id>` set the others (the memory model defaults to the writer, the judge to the memory
model). Thinking stays off, the app's default, so the model is asked not to reason. The report names the exact ids.

Other flags: `--samples N` (default 3), `--probes A,C`, `--words N` (Generate's length, default 600), `--add-words N`
(Add below, 400), `--beat-scene-words N` (the scene length a beat's share comes from, 900), `--price-in X --price-out Y`
(USD per million tokens, for an estimated cost: DeepSeek reports tokens, not cost), `--out <folder>`, `--keep` (keep
the throwaway world, with "What the AI saw" for every call), `--base-url <url>` (only to check the harness against a
local fake server).

Each run writes `traps-results/<date>-<branch>-<commit>/`: `report.md` (the scores), `report.json` (everything,
including each passage and the judge's answers) and `passages.md` (every passage, for reading). A checkout with no
branch (an old release) is named by its version. A "Could not start the token worker" warning is expected: token
counting falls back to the main thread, with the same counts.

## Check and repair (step 3)

When the checkout has step 3 (`src/main/ipc/repair.ts`), each passage goes through it the way the page sends it as
the words land: the scene is saved with the new words in, `checkNewWords` is asked with the new paragraphs and the
lead-in (one memory-model call), the fixes are made on a ProseMirror copy of the page with the app's own page code
(`features/repair/apply.ts`: `landedParts`, `fixesTr`; a plain-text copy of it, `page.ts`, if a checkout lacks that
file), and `repairsApplied` is told which were made. Then the scene goes back to how it was and the issues it raised
are cleared, so every sample starts the same. The passage is scored as written and, when a fix changed it, again
after the fixes (a second judge call). The report gives both scores by trap and by probe, the fixes and the
questions; `passages.md` has each question's words and the passage after the fixes. Repair calls are counted as
their own job. It is switched on for the run (`checkNewWords` in Settings, and `AIWRITE_REPAIR`). Older checkouts run
exactly as before.

## Cost (an estimate)

Story version 2, 3 samples: about 95 calls: 18 written passages (6 probes), 18 judge calls, and 50 to 60 memory calls
(the memory reading each scene, where things stand, scene and chapter summaries). Roughly 135,000 tokens in and
32,000 out (the step 1 run on version 1, 15 passages, used 116,000 in and 27,000 out in 81 calls). Step 3 adds one
repair call per passage (18) and a judge call for each passage a fix changed (up to 18): about 35 more calls and
65,000 tokens in, 15,000 out. DeepSeek's API reports tokens but not cost, so the report always gives the tokens by job,
and an estimated cost when `--price-in` and `--price-out` are given. At DeepSeek's chat prices (about $0.28 per million
tokens in and $0.42 out, less for cached input; check their pricing page for Flash) that is about 5 to 10 cents a run.
Each extra sample adds 12 calls (a passage and a judge call per probe), 24 with check and repair.

## The traps

| Trap | The truth | Where it is tested |
|---|---|---|
| Clothes taken off | Mara takes off her grey coat (hook by the hearth) and boots (on the hearthstones) partway through scene 2; later her coat is hidden and she wears Tobin's brown oilcloth jacket | A, B, C, D, E, F |
| An injury | Her LEFT palm is cut on the harbour wall's glass and stays bandaged | A, B, C, D, E, F (plus a right-hand tripwire) |
| People in rooms | Scene 3 ends with Mara and Ilse in the cellar, Tobin in the attic, Dask at the door; in scene 7 Tobin is out in the stable; Mara reaches Saltreach alone | B, C, E |
| Who knows what | Mara tells only Ilse the letters go to the Bishop of Saltreach; Tobin believes Fennick. In scene 6 Ilse passes Mara off to Dask as her cousin from inland, so nobody may name her or call her a courier in front of him | C, D, F |
| A promise made early | In scene 1 Mara promises to give Tobin's father's knife back before they part; she does at the fork, so she no longer has it | D, E |
| Where an item is | The packet: in the brandy cask in the cellar (scenes 3 to 7), then inside Mara's jacket | B, C, F |
| Posture and what is held | Partway through scene 7 Mara sits on the hearth bench with Tobin's knife across her knees | C |
| A detail from scenes back | In scene 7 the grey mare is lame, so Mara rides the bay; scene 9's card never says which horse (and her grey coat is a decoy) | E (plus a grey-horse tripwire) |

## The probes

| Probe | What the app is asked | On the page |
|---|---|---|
| A | Add below in scene 2 | The first 3 paragraphs: just after the coat and boots come off |
| B | Generate scene 4 from its card (Dask at the door) | Empty |
| C | Continue at the cursor in scene 7 | The first 3 paragraphs: Mara back in the kitchen with the packet, on the hearth bench with the knife across her knees, Tobin out in the stable |
| D | Beat 2 of scene 8 (the fork, where Tobin turns back) | Beat 1 as written |
| E | Generate scene 9 from its card (the Bishop's house) | Empty |
| F | Add below in scene 6 | The first 3 paragraphs: Dask's men searching, Mara at the table passed off as Ilse's cousin |

## How it scores

Each passage goes to a judge (the memory model unless `--judge` says otherwise) with only the passage, the facts true
where it begins, and yes/no questions; each question has the answer that means "broken". The judge answers yes, no
or unclear, quoting the passage. It is told that movement shown on the page counts (a creak on the stairs before
someone appears is them coming down) and that boots or a coat seen nearby aren't being worn.

- **kept**: the judge gave the good answer.
- **broken**: the bad answer, with a quote that really is in the passage (or, for something that should happen and
  doesn't, like the promise, a plain "no"); or a tripwire matched (a deterministic pattern: the cut put on the right
  hand).
- **unverified**: the bad answer with a quote the passage doesn't have. Not counted as broken; listed in the report.
- **not touched**: "unclear", or the judge's reply couldn't be read.

Consistency is kept / (kept + broken), by trap, by probe and in all; the report also gives broken per passage.

Known weaknesses: the judge is a model and can miss a slip or misread one (the quote rule stops it inventing
contradictions, not missing them); "not touched" checks don't count, so a passage that avoids a subject scores as
well as one that gets it right; the promise check counts silence at the parting as broken; samples are few, so a
difference of one or two broken claims between runs is noise, not a result. Use the same writer, memory and judge
models, and the same `STORY_VERSION`, for every run you compare.

**Story versions.** Version 2 (7 October 2026) rewrote the questions the step 1 run showed were misread (B2 counted
Tobin as never coming down although each passage had him on the stairs; a pair of boots nearby counted as worn), told
the judge that movement on the page counts, and added harder traps (who knows what in front of Dask, posture and the
knife in Continue, the horse two scenes back) and probe F. Scores from version 1 (the 0.6.24, main and step 2 runs of
7 October) don't compare with version 2's: run them again to compare with step 3; `--compare` says so when the
versions differ.

## Changing the story

The story, the probes and their checks are data in `story.ts`. Bump `STORY_VERSION` when they change. The checker's
own tests are in `tests/unit/traps.test.ts` (they also check that every probe fits its scene).
