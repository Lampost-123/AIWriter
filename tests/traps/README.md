# Trap scores

Step 6 of the story memory plan: an invented story with continuity traps planted in it, and a harness that asks the
app to write at chosen points and scores, claim by claim, whether what it wrote keeps to the truth. Run it on main
and on each step's branch, with the same model, to see whether a step really helps.

It runs the app's own main-process code (settings, providers, world, memory keeper, briefing, drafting) in plain
Node, with a stand-in for Electron and a throwaway data folder, so it measures what Adam gets. It never touches
Adam's library, settings or keys, and it is never part of `npm test` or CI.

## Running it

```sh
# Check the harness itself: fake provider, stand-in judge, no key, no cost. Not a score.
npm run traps -- --fake

# A real score of this checkout on DeepSeek Flash (OpenRouter). The key is read from this variable only.
OPENROUTER_API_KEY=sk-or-... npm run traps

# The same harness on another checkout's app code (it needs its own node_modules: npm ci there first)
OPENROUTER_API_KEY=sk-or-... npm run traps -- --root ../AIWriter-stage

# Side by side
npm run traps -- --compare traps-results/<main run> traps-results/<branch run>
```

In PowerShell, set the key first with `$env:OPENROUTER_API_KEY = 'sk-or-...'`.

Flags: `--samples N` (default 3), `--probes A,C`, `--writer <id>`, `--memory <id>` (default: the writer),
`--judge <id>` (default: the memory model), `--words N` (Generate's length, default 600), `--add-words N` (Add below,
400), `--beat-scene-words N` (the scene length a beat's share comes from, 900), `--out <folder>`, `--keep` (keep the
throwaway world, with "What the AI saw" for every call). With no `--writer`, the newest `deepseek/...flash` model in
OpenRouter's list is used; the report names the exact ids.

Each run writes `traps-results/<date>-<branch>-<commit>/`: `report.md` (the scores), `report.json` (everything,
including each passage and the judge's answers) and `passages.md` (every passage, for reading). A "Could not start
the token worker" warning is expected: token counting falls back to the main thread, with the same counts.

## Cost

About 70 calls per run with 3 samples: 15 written passages (Generate, Add below, Continue, a beat), 15 judge calls,
and about 40 memory calls (the memory reading each scene, where things stand, scene and chapter summaries). Roughly
90,000 tokens in and 30,000 out: a few cents on DeepSeek Flash, under $0.10 at its usual prices. Each extra sample
adds 10 calls (a passage and a judge call per probe). The report shows the cost OpenRouter reported, by job.

## The traps

| Trap | The truth | Where it is tested |
|---|---|---|
| Clothes taken off | Mara takes off her grey coat (hook by the hearth) and boots (on the hearthstones) partway through scene 2; later her coat is hidden and she wears Tobin's brown oilcloth jacket | A, B, C, D, E |
| An injury | Her LEFT palm is cut on the harbour wall's glass and stays bandaged | A, B, C, D, E (plus a right-hand tripwire) |
| People in rooms | Scene 3 ends with Mara and Ilse in the cellar, Tobin in the attic, Dask at the door; in scene 7 Tobin is out in the stable; Mara reaches Saltreach alone | B, C, E |
| A secret told to one person | Mara tells only Ilse the letters go to the Bishop of Saltreach; Tobin believes Fennick | C, D |
| A promise made early | In scene 1 Mara promises to give Tobin's father's knife back before they part; she does at the fork, so she no longer has it | D, E |
| Where an item is | The packet: in the brandy cask in the cellar (scenes 3 to 7), then inside Mara's jacket | B, C |

## The probes

| Probe | What the app is asked | On the page |
|---|---|---|
| A | Add below in scene 2 | The first 3 paragraphs: just after the coat and boots come off |
| B | Generate scene 4 from its card (Dask at the door) | Empty |
| C | Continue at the cursor in scene 7 | The first 3 paragraphs: Mara back in the kitchen with the packet, Tobin out in the stable |
| D | Beat 2 of scene 8 (the fork, where Tobin turns back) | Beat 1 as written |
| E | Generate scene 9 from its card (the Bishop's house) | Empty |

## How it scores

Each passage goes to a judge (the memory model unless `--judge` says otherwise) with only the passage, the facts true
where it begins, and yes/no questions; each question has the answer that means "broken". The judge answers yes, no
or unclear, quoting the passage.

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

## Changing the story

The story, the probes and their checks are data in `story.ts`. Bump `STORY_VERSION` when they change. The checker's
own tests are in `tests/unit/traps.test.ts` (they also check that every probe fits its scene).
