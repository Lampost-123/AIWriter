# Trap scores

An opt-in test of story memory on a real model. An invented story has continuity traps planted in it. The harness asks
the app to write at chosen points, the way Adam writes, and scores claim by claim whether what it wrote keeps to the
truth. Run it on two checkouts, with the same model and the same story, to see whether a change really helps.

It runs the app's own main-process code (settings, providers, world, memory keeper, briefing, drafting, check and
repair, recall) in plain Node, with a stand-in for Electron and a throwaway data folder, so it measures what Adam gets.
It never touches Adam's library, settings or keys. It is never part of `npm test` or CI: only `npm run traps` and
`npm run traps:write` run it (the checker's own unit tests, `tests/unit/traps*.test.ts`, do run in `npm test`; they
need no model and no network).

## Running it

**The key.** A real run uses DeepSeek's own API with DeepSeek Flash for every role (writer, memory, judge). The key is
read from `DEEPSEEK_API_KEY` only: from the terminal's environment or, on Windows, from the user's saved environment
variables. Save it once, in a terminal of your own, and never paste it into a chat, a file or a command you share:

```powershell
setx DEEPSEEK_API_KEY "<your key>"
```

Open a new terminal afterwards. The key is never printed or written to a report. Without it a real run refuses to
start before any network call; `--fake` needs no key and no network.

```powershell
# Check the harness itself: fake provider, stand-ins, no key, no network, no cost. Not a score.
npm run traps -- --fake --out <a folder of your own>

# A real score of this checkout on DeepSeek Flash (probes v4, 5 chains). Costs money: see "Cost per run".
npm run traps -- --samples 5 --max-tokens-in 4000000 --out <report folder>

# The same harness and story on another checkout's app code (it needs its own node_modules: npm ci there first).
npm run traps -- --samples 5 --max-tokens-in 4000000 --root <other checkout> --out <report folder>

# Again, from the world an earlier run of the same app code saved: the story's memory build is skipped.
npm run traps -- --samples 5 --root <other checkout> --from-world <earlier report folder> --out <report folder>

# A chain run scored again with the checks as they are now: no model, no cost.
npm run traps -- --rescore <report folder> --out <another folder>

# Side by side
npm run traps -- --compare <report folder> <report folder>
```

A report folder that already has a report is never written over, and the harness never deletes one.

**The provider** is DeepSeek, set up as the app's DeepSeek preset does it in Settings › Models: an OpenAI-compatible
provider at `https://api.deepseek.com/v1`. `--provider openrouter` uses OpenRouter instead (`OPENROUTER_API_KEY`).

**The models**: with no `--writer`, the model whose id has "flash" in it in the provider's model list (free to ask) is
the writer, the memory model and the judge. If none is listed, the run stops before any paid call and lists the ids
it found: pick one with `--writer <id>` (`--memory`, `--judge` for the others). Thinking stays off, the app's default.

**The token budget** (`--max-tokens-in`, `--max-tokens-out`; default 2,000,000 in and 500,000 out) applies to writing
and to scoring, per command. Before every model call the tokens used so far (every call the app made is a record in
the throwaway world, plus the judge's) and what the call will send are checked; once the budget would be passed, no
more calls are sent and the run stops cleanly: scoring writes its report so far, marked as stopped; writing saves its
progress for `--resume`. A chain run of main needs `--max-tokens-in 4000000` (it used 2.5 to 2.9 million in rounds 7
and 8).

**The provider guard** (`guard.ts`, real runs only): a reply of HTTP 402 or one naming an insufficient balance, or 401
(the key refused), stops the run the budget's way at once, with a line starting "PROVIDER STOP"; HTTP 429 is waited
out a few times (Retry-After when given) before the app's own retries see it, and stops the run once it lasts through
three rounds of that.

**The saved world.** Much of a run's cost is the memory reading the story before the first probe; that depends only on
the app code being scored and the story, not on the probes. So each run saves the world as it stands just before the
first probe (`world-before-chain.db` for chains, `world-before-s24.db` for probes v2 and v3, with a `.json` saying what
it was made from) beside its report, and `--from-world <report folder>` starts a later run there. It is used only for
the same story file, the same models and, for chains, the same world-building code (`worldCode.mjs`: the git ids of
the memory keeper, where things stand, the memory's model, the database and the few files they write through, with no
uncommitted changes there; or the very same `src` folder), so a commit to the writer's prompts keeps the world; probes
v2 and v3 still need the same `src` folder. The story's id is its file's hash with line endings made LF, so a checkout
with core.autocrlf gives the same id (worlds saved with the old id still match). Anything else is refused. A copy is opened; the saved file is never changed. `--no-save-world`
skips saving it.

**Recall by meaning (step 5)** needs the search model's files (bge-small-en-v1.5, as the app downloads them). The
harness never downloads them: it copies them from `--search-model <folder>` (default `traps-results/search-model`, not
committed). Without them the run uses keyword search, sticky entries and what was said only, and the report says so.

Other flags: `--probes-version 4|3` (4, chains, is the default), `--story v2` or `--story-file <file>`, `--samples N`
(default 3), `--probes G1,C1` (probes v3), `--words N`, `--add-words N`, `--beat-scene-words N`, `--price-in X
--price-cached Y --price-out Z` (USD per million tokens for the estimated cost; default DeepSeek's prices, 0.28, 0.028
for input read from its cache, and 0.42), `--keep` (keep the throwaway world, with "What the AI saw" for every call),
`--base-url <url>` (only to check the harness against a local fake server). The comment at the top of
`tests/traps/cli.mjs` lists them all.

**What a run writes**: `report.md` (the scores), `report.json` (everything, including each passage and the judge's
questions and answers) and `passages.md` (every passage, for reading), and always, even when it stops or fails, the
evidence: each chain's world database (`evidence-K1-<n>.db`, or `evidence-world.db` for probes v2 and v3: every call
the app made, what was sent and what came back) and `evidence-index.json` (which records belong to which step: the
writer's draft, a plan, where things stand, the repair, memory reads). For step 3 and later, `repair.drops` counts what
each repair reply held and what the app's rules drop from it. A "Could not start the token worker" warning is expected
on older checkouts: token counting falls back to the main thread, with the same counts.

## Results so far

Real runs on DeepSeek Flash, story version 3, probes v4: chains of 12 AI steps in one new scene after the whole story,
each later step checked against every fact still in force. "Slips per step" is broken checks per AI step (lower is
better); consistency is kept / (kept + broken). From each report's own figures:

| Round | App | Chains (steps) | Consistency | Slips per step |
|---|---|---:|---:|---:|
| 6 | 0.6.24 | 3 (26; one chain given up) | 83% | 0.54 |
| 6 | 0.6.29 | 3 (36) | 85% | 0.39 |
| 7 | 0.6.24 | 5 (60) | 78% | 0.55 |
| 7 | 0.6.30 (step 2b, before "one place") | 5 (60) | 92% | 0.17 |
| 8 | 0.6.30 as released (with "one place", #67) | 5 (60) | 95% | 0.12 |

What still slips on 0.6.30 (round 8): the survey case back in her arms after it was put on the sill (4 of 7), Ash
acting in the room while he is out at the stable (2), Wren up and about while last lying down (1). Boots, coat, the
locked door, the cut hand's side, the compass given away and the burn's side held in every step. 0.6.24's slips in
round 7 were the locked door opening without being unlocked (12), the case (17) and lying down (4).

Earlier rounds (probes v1 to v3, single passages at chosen points) ended at the ceiling: 0.6.24 scored 100% on probes
v3, which is why the chains were built. Their scores don't compare with chains.

## What each probe version tests

| Version | How the app is asked | What it tests |
|---|---|---|
| v1 (round 3) | One passage at each of 7 chosen points in story version 3: Generate, Continue, a beat, Add below | Facts chapters back or early in a long scene (burn's side, horse changed, compass given away, scar's side, a promise, who knows what, clothes off, someone gone). Most checks ended "not touched": the passages never came near the traps. |
| v2 (round 4) | The same points, each aimed at its traps with what Adam would type (a direction, a beat's note, the card's beats), never saying what is true | The same traps, now reached; a mention is no longer a slip. |
| v3 (round 5) | As v2, with B1's page cut before the bead is first mentioned, and only narration counted for Bryn | As v2, fixing two probes that gave the answer away or misread reported speech. |
| v4 (rounds 6 to 8, the default) | Chains: a new scene after the whole story, 12 steps of Add below and Continue in turn, as Adam writes | Within one scene and across scenes: boots and coat off, someone gone out, a door locked, a case put down, lying down, a cut hand's side, plus the compass and the burn from chapters back, at every later step. |

Story version 2 (`--story v2`, nine short hand-written scenes) is kept for checking the harness; every fact fitted in
what the writer is shown, so it can't tell versions apart.

## The prose check

How the AI writes, not only what it keeps true (Adam, 2026-10-08, after an audit of 122 real writer calls from rounds 7
and 8). Every passage of every probe version is measured with no extra model call (`prose.ts`), from the passage,
the scene before it, the earlier steps of its chain and the writer's own saved prompt:

- **Length**: words against the words asked (Add below, Generate, a beat; Continue sets its own), and how many ran over
  1.5 times: Add below invents action to fill its length.
- **Recap**: the share of the passage's 4-word runs already in the scene; and whether its first sentence echoes the
  last paragraph before it.
- **Echoes from earlier steps**: 6-word runs the chain's earlier AI steps already used (the writer repeating itself,
  or starting the scene again).
- **Sample lines copied**: the sample lines of dialogue the writer was sent (read from its saved prompt) that the
  passage copies word for word ("That's the way of it.").
- **Stock tics** ("the rain went on", "neither of them said", "unhurried"...), **closing the scene off** at the end
  (sleep, silence, a summing-up line), and **"and" per 100 words**.
- **A card beat done again**: each chain scene beat has a pattern for how it shows (K1: reaching the inn, which the
  opening already did; plans for what comes next, said aloud, two or more); a step that shows a beat the scene had
  already shown does it again.
- **The judge's marks**, 1 to 5 with what 1, 3 and 5 look like: distinct voices, subtext, sticking to the direction
  (no invented events), ending mid-motion. They are asked in the judge's usual call for a passage, never in a call of
  their own, so a chain step with no judge question (the early steps) is not marked.

The report has a Prose section (medians, counts and the worst examples) and `--compare` puts two runs' side by side.
`--rescore` measures a saved run's passages and prompts with no cost (the judge's marks only where a run saved them),
so older runs give the baseline. From rounds 7 and 8, re-scored (5 chains, 60 steps each):

| | 0.6.24 | 0.6.30, step 2b | 0.6.30 as released |
|---|---|---|---|
| Add below over 1.5 times its length | 0 of 30 | 4 of 30 | 2 of 30 |
| Recap (median) | 4% | 3% | 2% |
| Opening echoes the last paragraph | 0 | 3 | 2 |
| Steps echoing an earlier step's 6-word runs | 35 | 31 | 30 |
| Sample lines copied | 4 | 9 ("That's the way of it." 8) | 5 ("That's the way of it." 5) |
| Steps with a stock tic | 16 | 32 ("the rain went on" 14) | 26 ("the rain went on" 13) |
| Closes the scene off | 7 | 6 | 4 |
| "and" per 100 words (median) | 5.4 | 6.6 | 6.8 |
| Does a card beat again | 31 (28 reach the inn again) | 7 | 8 |

**Held out** (2026-10-08): measures nothing in the writer aims at, so a change can't be tuned to them: "not X, but Y"
contrasts per 1,000 words (slop-score's patterns, `slopScore.ts`, MIT, Sam Paech), one-line fragment paragraphs (5
words or fewer, no speech), 5-word runs from earlier steps, a paragraph already on the page and the scene saying
something twice, a line of dialogue included (`echo.ts`, from Poor Mans Holodeck). Older reports lack them; a re-score
adds them.

A chain step is measured, and the judge's marks asked, on its words as they went onto the page, after check and repair
(since 2026-10-08; before, on the words as written).

Limits: the metrics count words, not meaning, and the lists (tics, closing words, beat patterns) know only what the
audit found; the judge's marks are one model's opinion, from a passage's own words only.

## Cost per run (from the real reports)

DeepSeek reports tokens, not cost; the report estimates it at DeepSeek's prices ($0.28 per million tokens in, $0.028
for input read from its cache, $0.42 out). From the real runs:

| Run | Tokens in (from cache) | Out | About |
|---|---|---:|---:|
| Writing story version 3 (once, done) | 0.91M | 186k | $0.33 |
| Probes v2/v3, 3 samples, 0.6.24 (rounds 4, 5) | 0.66M to 0.70M (0.33M to 0.35M) | 104k to 118k | $0.15 to $0.16 |
| Probes v2, 3 samples, 0.6.29 (round 4) | 1.23M (0.59M) | 175k | $0.27 |
| Chains, 0.6.24, from a saved world (rounds 6, 7) | 0.81M to 1.50M (0.48M to 0.93M) | 112k to 194k | $0.15 to $0.27 |
| Chains, main 0.6.29 / 0.6.30 (rounds 6 to 8) | 2.18M to 2.91M (0.73M to 1.00M) | 246k to 373k | $0.53 to $0.72 |

Main costs more than 0.6.24 because of what it does per step: step 2's checkpoints, step 3's check and repair on every
step, step 4's plan for every Add below. A run from a saved world leaves out most of the story's memory build.

## Known checker limits

- **Patterns only know the wordings they were taught.** They never invent a slip, but they miss one worded another way,
  and a planted event the writer did show may not be found. Round 7 gave up two chains because "She turned it" and
  "the lock went over" weren't known as locking, and Ash was named once and then "he". Plants may now span three
  neighbouring paragraphs, "he" and "she" are followed through the narration, and the judge is asked once when the
  patterns find nothing. The drift checks themselves are still patterns only.
- **The judge can misread.** In round 7 it quoted "She got up and turned the key" as Wren standing without getting up.
  A slip whose own words, or words before it, show the change is now kept; other misreadings are possible. A broken
  answer needs a quote that is in the passage, else it is "unverified" and not counted.
- **A writer that starts the scene again** (the inn reached a second time, the case "under her arm, where it had been all
  day") counts as slips against the plants in force. That is a real fault of the draft, but it is not memory loss.
- **"Not touched" doesn't count**, so a passage that avoids a subject scores as well as one that gets it right.
- **Few samples**: five chains of twelve steps. A difference of one or two broken checks is noise.
- **Approximations**: the memory reads straight after each step (in the app, after 30 seconds of quiet); every Continue
  is accepted as it comes; a step whose plant didn't land is drafted again before it reaches the page.
- **`--rescore` can't ask the judge.** A slip that the live judge cleared ("did Ash come back first?") stays cleared
  when the judge's words for the change are in the passage before the slip found now; a slip the live judge was asked
  about word for word stays broken; any other slip a pattern finds where the judge would be asked is listed as "would
  need the judge" and counted as broken in the re-score.
- **The judge is asked over the scene since the plant** (`endedAsk`, `confirmSlips`; since round E, 2026-10-08): the
  steps from the plant's own, as they went onto the page, then the step checked, so a change shown in an earlier step
  in words no pattern knows (Ash back at step 6, the slip at step 7) is seen. A yes counts when its words are there,
  after the planting and before the slip, and the plant ends at the step they are in. Runs before this asked about the
  step alone, and a re-score only reuses their answers: their slips after such a change stay broken unless a pattern
  knows the wording. The patterns are still taught each wording found.
- **The names are fixed.** Who "he" and "she" can stand for is a list of the chain scene's people (`chain.ts`).

Use the same models and the same story file for every run you compare.

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

Each scene is written in order from its card with this checkout's app code, saved and read by the memory before the
next, as Adam works. Its planted events go to the writer as the draft's direction, never on the card (so a later
probe's card gives nothing away). After each draft:

- every planted event must really happen: a paragraph that matches (for example "left forearm" and "burn" together),
  else one judge call that must answer yes with a quote that is in the scene; early events in the first third;
  nothing later in the scene may undo them (her boots stay off, Bryn stays away);
- the scene must keep to what earlier scenes made true (no right-arm burn, no compass, no riding Thistle, Ash's scar
  on the left; deterministic checks).

A scene that fails is written again, twice at most; then the writing stops and says why. Progress is saved after
every scene to `tests/traps/story-v3.partial.json` (not committed); carry on with
`npm run traps:write -- --resume tests\traps\story-v3.partial.json`. The finished `story-v3.json` holds the scenes,
the codex, each planted event's exact sentence and paragraph, the model, the date, the app commit and the tokens used.
An existing story file is never written over (`--out <file>` for another).

## Probes v4: chains (the default)

Adam, 2026-10-07: probes v3 were at the ceiling (0.6.24 scored 100%), and they asked once at a chosen point, which is
not how he writes. He writes long stories on DeepSeek Flash mostly with Continue and Add below, carrying a scene on
step by step, and his complaint was the AI forgetting where people are, how they are placed and what they wear, within
a scene and across scenes. A chain does what he does (`chain.ts`):

- **The world**: the whole written story (30 scenes), read by the memory as Adam's would be; saved after the last scene
  (`world-before-chain.db`), and each chain sample starts from a fresh copy of it, so every sample starts the same and
  the start of each is read from DeepSeek's cache.
- **The chain** (K1, "The inn on the coast road"): a new scene with two paragraphs as Adam would type them, then 12 AI
  steps in the same scene, Add below and Continue in turn, through the window's own entry points (`startDraft` with
  `addBelow`, about 350 words; `startEdit` Continue at the end of the text, the app's own 120 to 250 words). Each Add
  below has at most a short direction as Adam would type it; Continue takes none.
- **Plants**, in the early steps' directions and never said again: boots off by the hearth and coat on the peg (step
  1); Ash goes out to the stable and Wren locks the door, key in her pocket (3); the survey case on the windowsill and
  Wren lying down on the settle (5); a shard cuts her RIGHT palm (7). Steps 9 and 11 are bait without the truth
  ("Someone knocks at the door.", "Wren wonders which way the coast road runs from here in the dark."). Each plant
  must land in its step: a paragraph that shows it, or up to three neighbouring ones (Ash named once, then "he went
  out"; "he" counts as Ash while he was the last man named in the narration); where no pattern finds it, the judge is
  asked once whether it happens, and a yes counts only with words that are in the draft. Else the step is drafted
  again, twice at most, else the chain is given up and the report says so. Facts from chapters back are checked from
  the first step: the compass given away, the burn on her LEFT forearm.
- **Between steps**, as when Adam pauses: the step lands in the page (saved), step 3's check and repair runs on the
  landing and its fixes go into the page, then the memory reads the scene and everything that follows a read finishes
  (where things stand, the live stage's checkpoints, step 4's and 5's upkeep), and step 5's index catches up.
- **Checks at every later step**, for every plant still in force: boots or coat on with no words, the gone person
  speaking or acting in the room, the locked door opening or someone coming in without unlocking, the cut on the left
  hand, the compass in use, the burn on the right (deterministic, the narration only: dialogue, mentions, memories and
  negations aren't slips); standing or walking when last lying down, and the case in her arms when last on the sill
  (the judge, with precise questions and a pattern as tripwire). A change shown on the page (she pulls her boots back
  on, unlocks the door, Ash comes back in, Wren gets up) ends that plant: it isn't checked after that step, and a slip
  whose words show that change is kept. Getting up must be Wren's ("Ash got up" doesn't count).
- **The report**: consistency over every later-step check, by plant and by step, "chains slipped by step N" (when drift
  starts), what drifted with the words, check and repair's fixes and questions, and the evidence.
- **Chain K2** ("Fog on the coast road", `--probes K2`; K1 alone runs unless named, so scores stay comparable): the
  open road in sea fog the next morning, with a carter met on the way. Plants: the fog (far views or sunshine before
  it lifts), leading the horses on foot (riding before getting back on), the LEFT ankle twisted (the right one hurt;
  and, by the judge, running or striding with no limp), the sealed claim handed to Wren (Ash with it again), and Ash
  telling only Wren he won't go back to Linmouth (the carter knowing it, by the judge).

## Check and repair (step 3)

When the checkout has step 3 (`src/main/ipc/repair.ts`), each passage goes through it the way the page sends it as
the words land: the scene is saved with the new words in, `checkNewWords` is asked with the new paragraphs and the
lead-in (one memory-model call), the fixes are made on a ProseMirror copy of the page with the app's own page code
(`features/repair/apply.ts`; a plain-text copy, `page.ts`, if a checkout lacks it), and `repairsApplied` is told
which were made. The passage is scored as written and, when a fix changed it, again after the fixes. Repair calls are
counted as their own job. It is switched on for the run (`checkNewWords` in Settings, and `AIWRITE_REPAIR`). Older
checkouts run exactly as before.

## Recall by meaning (step 5)

When the checkout has step 5 (`src/main/retrieval/`), the run gives it what Adam's app has after its own download:
the search model's files are copied from `--search-model` into the run's app data folder with the record the app's
download leaves; "Find by meaning" is on, and so is step 5 (`AIWRITE_RECALL`). Before each step the search index is
brought up to date and the harness waits until the model has read every passage, so the briefing really searches by
meaning. The report says whether finding by meaning was on for every probe, with which engine, and how many passages
had been read. The model reads on worker threads, as in the app: the trap config bundles the app's `?nodeWorker`
scripts with esbuild into the temp folder and starts them as real worker threads (onnxruntime-node loads from the
checkout's own node_modules).

## Story version 3: the traps (probes v1 to v3)

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

| Probe | What the app is asked | Aimed with (v2, v3) | On the page |
|---|---|---|---|
| G1 | Generate s28 (fog on the fell) | "Show, step by step, how Wren finds her bearings when the fog comes down. Name the horses as they climb. Her old burn aches in the cold and wet. When they stop to rest, describe Ash's face up close." | Empty |
| C1 | Continue near the end of s24 | A last beat on the card: Wren gets up, rubbing her aching arm, and goes to the door to look at the storm | All but the last paragraph: the boots came off 1,300+ words back, beyond what Continue is shown |
| C2 | Continue near the end of s27 | A last beat: Wren rolls up her sleeves, the talk turns to Bryn, the firelight on Ash's scarred face | All but the last paragraph: Bryn left 1,300+ words back |
| B1 | Beat 3 of s26 (across the river, then goodbye to Pell) | The beat, with the note "Get them across the river first, then the goodbye on the far bank." | Up to just before the scene first mentions the bead (v3) |
| G2 | Generate s29 (the Assize) | They ride to the hall; Bryn beside Wren; Gale presses to find out what the survey shows; her sleeve rides up over her old burn | Empty |
| A1 | Add below halfway through s30 | Wren searches her pockets for a keepsake for Bryn, takes her bearings, they ride on; Ash's face | Half the scene |
| A2 | Add below halfway through s25 | Wren checks which way the river lies; her burned arm stiff on the reins; Ash's face in the wind | Half the scene |

## How it scores

**Deterministic checks** (`patterns.ts`), sentence by sentence, need no judge: a sentence that breaks the truth (her
burn on the right arm, Ash's scar on the right, still having the bead, Bryn speaking in the room) is **broken**, unless
the same sentence shows it isn't a slip ("the compass she no longer had") or the change was shown earlier in the
passage ("Bryn came back in"); a passage that mentions the subject without breaking it is **kept**; one that never
mentions it is **not touched**. A mention isn't a slip: riding needs a riding verb with Thistle as what is ridden;
having the compass needs it in her hand or pocket, taken out, opened or read, and never "in her head", a memory, a
wish or a negation. Speech is blanked out first where only the narration counts.

**Judge questions**, only where a pattern can't do it (who knows what, a promise kept, a case put down, lying down):
the judge gets only the passage, the facts true where it begins and yes/no questions, each with the answer that means
"broken". Broken needs a quote that really is in the passage (or, for something that should happen and doesn't, a
plain "no"); a bad answer with a quote the passage lacks is **unverified**, not counted.

Consistency is kept / (kept + broken), by trap, by probe or plant, and in all; the report also gives broken per
passage.

## Changing the stories and checks

Version 2 lives in `story.ts` (bump `STORY_VERSION`). Version 3's outline, probes and checks live in `story3.ts` (bump
`OUTLINE_VERSION`: a story written from another outline won't load, so write it again). The chain and its checks live
in `chain.ts`. The checks' own tests are in `tests/unit/traps.test.ts`, `tests/unit/traps3.test.ts` and
`tests/unit/trapsChain.test.ts`; add the exact lines a real run got wrong when you change a check.
