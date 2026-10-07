# Trap scores

Step 6 of the story memory plan: an invented story with continuity traps planted in it, and a harness that asks the
app to write at chosen points and scores, claim by claim, whether what it wrote keeps to the truth. Run it on each
step's checkout, with the same model and the same story, to see whether a step really helps.

It runs the app's own main-process code (settings, providers, world, memory keeper, briefing, drafting) in plain
Node, with a stand-in for Electron and a throwaway data folder, so it measures what Adam gets. It never touches
Adam's library, settings or keys, and it is never part of `npm test` or CI.

## The stories

- **Version 3 (the default)**: "The Salt Road", 30 scenes in 7 chapters (47,411 words), written once by a live
  DeepSeek Flash through the app's own Generate from a hand-written outline (`story3.ts`), then frozen in
  `story-v3.json` so every checkout is scored on the very same words. Adam, 2026-10-07: version 2 was too short (every
  fact fitted in what the writer is shown, so the memory never mattered and every step scored 99%), so make it much
  longer and have a live model write it. Every fact a probe tests is far from it: chapters back, or early in a long
  scene, beyond what Continue is shown.
- **Version 2** (`--story v2`): "The Gannet", nine short hand-written scenes in `story.ts`.

Scores from different story versions don't compare (`--compare` says so).

## Writing story version 3 (once)

```powershell
npm run traps:write
```

Each scene is written in order from its card with this checkout's app code (main), saved and read by the memory
before the next, as Adam works. Its planted events go to the writer as the draft's direction, never on the card (so a
later probe's card gives nothing away). After each draft:

- every planted event must really happen: a sentence that matches (for example "left forearm" and "burn" together),
  else one judge call that must answer yes with a quote that is in the scene; early events in the first third;
  nothing later in the scene may undo them (her boots stay off, Bryn stays away);
- the scene must keep to what earlier scenes made true (no right-arm burn, no compass, no riding Thistle, Ash's scar
  on the left; deterministic checks).

A scene that fails is written again, twice at most; then the writing stops and says why. Progress is saved after
every scene to `tests/traps/story-v3.partial.json` (not committed); carry on with
`npm run traps:write -- --resume tests\traps\story-v3.partial.json`. The finished `story-v3.json` holds the scenes,
the codex, each planted event's exact sentence and paragraph, the model, the date, the app commit and the tokens used.
Commit it. An existing story file is never written over (`--out <file>` for another).

## Scoring

```powershell
# Check the harness itself: fake provider, stand-ins, no key, no cost. Not a score.
npm run traps -- --fake --story-file <a fake-written story> --out <a folder of your own>

# A real score of this checkout (main) on DeepSeek Flash, through DeepSeek's own API.
npm run traps -- --samples 3 --out C:\Users\adox1\Documents\AIWriter-trap-scores\round4\step1

# The same harness and story on another checkout's app code (it needs its own node_modules: npm ci there first).
npm run traps -- --samples 3 --root C:\Users\adox1\Documents\AIWriter-stage --out ...\round4\step2

# Later: the same checkout again (new probes, more samples), from the world the run above saved: no memory build
# for the first 23 scenes.
npm run traps -- --samples 3 --root C:\Users\adox1\Documents\AIWriter-stage --from-world ...\round4\step2 --out ...\round5\step2

# Side by side
npm run traps -- --compare <report folder> <report folder>
```

A report folder that already has a report is never written over.

**The saved world.** Most of a run's cost is the memory reading the 23 scenes before the first probe; that depends
only on the app code being scored and the story, not on the probes. So each run saves the world as it stands just
before the first probe scene (`world-before-s24.db`, with a `.json` saying what it was made from) beside its report,
and `--from-world <report folder>` starts a later run there. It is used only for the same app code (git's id for the
checkout's `src` folder, with no uncommitted changes), the same story file and the same models; anything else is
refused. A copy is opened; the saved file is never changed. `--no-save-world` skips saving it.

**The key** is read from `DEEPSEEK_API_KEY` only: from the terminal's environment, or, on Windows, from the user's
saved environment variables (set with `setx DEEPSEEK_API_KEY ...` or System Properties). It is never printed or written
to the report. Without it a real run refuses to start.

**The provider** is DeepSeek, set up as the app's DeepSeek preset does it in Settings › Models: an OpenAI-compatible
provider at `https://api.deepseek.com/v1`. `--provider openrouter` uses OpenRouter instead (`OPENROUTER_API_KEY`).

**The models**: with no `--writer`, the model whose id has "flash" in it in the provider's model list (free to ask) is
the writer, the memory model and the judge. If none is listed, the run stops before any paid call and lists the ids
it found: pick one with `--writer <id>` (`--memory`, `--judge` for the others). Thinking stays off, the app's default.

**The token budget** (`--max-tokens-in`, `--max-tokens-out`; default 2,000,000 in and 500,000 out, well under $1 at
DeepSeek Flash's prices) applies to writing and to scoring, per command. Before every model call the tokens used so
far (every call the app made is a record in the throwaway world, plus the judge's) and what the call will send are
checked; once the budget would be passed, no more calls are sent and the run stops cleanly: scoring writes its report
so far, marked as stopped; writing saves its progress for `--resume`. The tokens used are printed at the end and kept in
the report.

Other flags: `--samples N` (default 3), `--probes G1,C1`, `--words N` (Generate's length, default 600), `--add-words N`
(Add below, 400), `--beat-scene-words N` (900), `--price-in X --price-cached Y --price-out Z` (USD per million tokens
for the estimated cost; default DeepSeek's chat prices, 0.28, 0.028 for input it reads from its cache, and 0.42),
`--out <folder>`, `--keep` (keep the throwaway world, with "What the AI saw" for every call), `--story-file`,
`--base-url <url>` (only to check the harness against a local fake server).

Each run writes `report.md` (the scores), `report.json` (everything, including each passage and the judge's answers)
and `passages.md` (every passage, for reading). A "Could not start the token worker" warning is expected: token
counting falls back to the main thread, with the same counts.

## Check and repair (step 3)

When the checkout has step 3 (`src/main/ipc/repair.ts`), each passage goes through it the way the page sends it as
the words land: the scene is saved with the new words in, `checkNewWords` is asked with the new paragraphs and the
lead-in (one memory-model call), the fixes are made on a ProseMirror copy of the page with the app's own page code
(`features/repair/apply.ts`; a plain-text copy, `page.ts`, if a checkout lacks it), and `repairsApplied` is told
which were made. Then the scene goes back to how it was and the issues it raised are cleared, so every sample starts
the same. The passage is scored as written and, when a fix changed it, again after the fixes. Repair calls are counted
as their own job. It is switched on for the run (`checkNewWords` in Settings, and `AIWRITE_REPAIR`). Older checkouts
run exactly as before.

## Recall by meaning (step 5)

When the checkout has step 5 (`src/main/retrieval/`), the run gives it what Adam's app has after its own download:
the search model's files (bge-small-en-v1.5) are copied from `--search-model <folder>` (default: the copy checked on
Adam's computer, in the session's scratch folder; never downloaded) into the run's app data folder with the record
the app's download leaves; "Find by meaning" is on, and so is step 5 (`AIWRITE_RECALL`). Before each probe the
search index is brought up to date and the harness waits until the model has read every passage, so the briefing
really searches by meaning. The report says whether finding by meaning was on for every probe, with which engine,
and how many passages had been read; without the model (missing, or `--search-model none`) it runs with keyword
search, sticky entries and what was said only, and says so. The model reads on worker threads, as in the app: the
trap config bundles the app's `?nodeWorker` scripts with esbuild into the temp folder and starts them as real worker
threads (onnxruntime-node loads from the checkout's own node_modules), which also lets token counting run on its
worker as in the app.

## Cost (an estimate)

At DeepSeek's chat prices (about $0.28 per million tokens in, $0.028 for input it reads from its cache, and $0.42 out;
check their pricing page for Flash). DeepSeek reports tokens, not cost; the report gives the tokens by job, how many
were read from the cache where the app records it (drafts and Continue; not the memory's calls), and an estimated cost.

- **Writing story version 3** (done once, 7 October 2026): 237 calls, 913,000 tokens in, 186,000 out.
- **Scoring on version 3, probes v2, 3 samples** (from round 3's real runs, scaled): the memory build up to the first
  probe is most of it and depends only on the app code; 7 probes x 3 passages add about 300,000 tokens in (the
  briefing for a 30-scene story is about 14,000 tokens), and step 3 onwards a repair call per passage (about 10,000).
  0.6.24 about 690,000 in and 120,000 out (about $0.24); step 1 about 725,000 and 120,000 ($0.25); step 2 about 855,000
  and 155,000 ($0.30); step 3 about 1,050,000 and 165,000 ($0.36); step 4 about 1,170,000 and 170,000 ($0.40). Five
  versions about $1.55 at full price; the samples of one probe send the same briefing, so DeepSeek's cache takes it
  nearer $1.35.
- **Again from a saved world** (`--from-world`): only scenes 24 to 29 are read: about 40% of the above.
- Round 3 (5 samples, probes v1) used 0.87 to 1.54 million tokens in a run. Round 4's 0.6.24 run (probes v2, 3
  samples) used 698,000 in (352,000 of them from DeepSeek's cache) and 118,000 out: about $0.16.
- Main with steps 1 to 5: about 1,250,000 in and 175,000 out (step 5's recall adds passages to each briefing; its
  search model runs on this computer, no tokens): about $0.25 to $0.30 with the cache.

## Story version 3: the traps (probes v2)

| Trap | The truth (scene it becomes true) | Tested by |
|---|---|---|
| An injury chapters back | Wren's LEFT forearm is burned (s2) | G1, C1, C2, G2, A2 (deterministic) |
| A horse changed and named | Thistle goes lame and stays at Hobb's Farm; Wren rides Ash's grey gelding Cinder (s9) | G1, G2, A1, A2 (judge, with a deterministic tripwire) |
| An item given away | Wren gives her brass compass to the bridge-keeper as a toll (s7) | G1, A1, A2 (judge, with a deterministic tripwire) |
| A scar on one side | A knife cuts Ash's LEFT cheek (s8), a scar by s14 | G1, C2, A1, A2 (deterministic) |
| A promise made in chapter 1 | Wren promises Pell a blue glass bead (s3), buys it (s13), gives it (s26) | B1 (judge), A1 (deterministic) |
| Who knows what | Only Ash (s6) and Bryn (s15) know the survey shows silver; Sela, Oskar, Pell and Gale never do | B1, G2 (judge) |
| Clothes off early in a long scene | Early in s24 (2,400 words) Wren takes off her coat and boots; they stay off | C1 (judge and a deterministic tripwire) |
| Someone gone early in a long scene | Early in s27 (2,400 words) Bryn takes the horses to the smith and doesn't come back | C2 (deterministic) |

## Story version 3: the probes (v2)

Probes v2 (Adam, 2026-10-07): in round 3 about 75 of every 120 checks were "not touched": the passages never came near
the traps. Each probe now aims its passage at its traps through what Adam would type himself (a draft's direction, a
beat's note, the scene card's beats for Continue), never saying what is true. Reports say "probes v2"; scores with
probes v1 (round 3) don't compare.

| Probe | What the app is asked | Aimed with | On the page |
|---|---|---|---|
| G1 | Generate s28 (fog on the fell) | "Show, step by step, how Wren finds her bearings when the fog comes down. Name the horses as they climb. Her old burn aches in the cold and wet. When they stop to rest, describe Ash's face up close." | Empty |
| C1 | Continue near the end of s24 | A last beat on the card: Wren gets up, rubbing her aching arm, and goes to the door to look at the storm | All but the last paragraph: the boots came off 1,300+ words back, beyond what Continue is shown |
| C2 | Continue near the end of s27 | A last beat: Wren rolls up her sleeves, the talk turns to Bryn, the firelight on Ash's scarred face | All but the last paragraph: Bryn left 1,300+ words back |
| B1 | Beat 3 of s26 (goodbye to Pell) | The beat itself (the parting) | Up to just before the bead is given |
| G2 | Generate s29 (the Assize) | They ride to the hall; Bryn beside Wren; Gale presses to find out what the survey shows; her sleeve rides up over her old burn | Empty |
| A1 | Add below halfway through s30 | Wren searches her pockets for a keepsake for Bryn, takes her bearings, they ride on; Ash's face | Half the scene |
| A2 | Add below halfway through s25 | Wren checks which way the river lies; her burned arm stiff on the reins; Ash's face in the wind | Half the scene |

When a written scene is too short for the planned distance, the report says so on the probe.

## How it scores

**Deterministic checks** (`patterns.ts`), sentence by sentence, need no judge: a sentence that breaks the truth (her
burn on the right arm, Ash's scar on the right, still having the bead, Bryn speaking in the room) is **broken**, unless the same
sentence shows it isn't a slip ("the compass she no longer had") or the change was shown earlier in the passage ("Bryn
came back in"); a passage that mentions the subject without breaking it is **kept**; one that never mentions it is
**not touched**. They replace the judge questions it misread (version 2's B2 counted Tobin as never coming down
although every passage had him on the stairs). Probes v2 tightened them so a mention isn't a slip: round 3 counted
"'I've got to fetch Thistle,' she said." as riding Thistle and "she held the compass in her head instead of her hand"
as having the compass. Riding now needs a riding verb with Thistle (or a mare) as what is ridden in one sentence;
having the compass needs it in her hand or pocket, taken out, opened or read, and never "in her head", a memory, a
wish or a negation. Where a pattern can't be sure (the horse, the compass), the judge decides, with a precise
question and examples of what doesn't count, and the pattern stays behind it as a tripwire.

**Judge questions**, only where a pattern can't do it (who knows what, a promise kept, clothes worn): the judge (the
memory model unless `--judge`) gets only the passage, the facts true where it begins and yes/no questions, each with
the answer that means "broken". Broken needs a quote that really is in the passage (or, for something that should
happen and doesn't, a plain "no"); a bad answer with a quote the passage lacks is **unverified**, not counted.

Consistency is kept / (kept + broken), by trap, by probe and in all; the report also gives broken per passage.

Known weaknesses: patterns miss slips worded in ways they don't know (they never invent one); the judge can miss or
misread; "not touched" checks don't count, so a passage that avoids a subject scores as well as one that gets it right;
samples are few, so a difference of one or two broken claims is noise. Use the same models and the same story file for
every run you compare.

## Story version 2

Nine short hand-written scenes ("The Gannet") in `story.ts`, probes A to F; see the comments there. Version 2 (7 October
2026) rewrote the questions version 1 misread and added harder traps; scores from different versions don't compare.

## Changing the stories

Version 2 lives in `story.ts` (bump `STORY_VERSION`). Version 3's outline, probes and checks live in `story3.ts` (bump
`OUTLINE_VERSION`: a story written from another outline won't load, so write it again). The checks' own tests are in
`tests/unit/traps.test.ts` and `tests/unit/traps3.test.ts`.
