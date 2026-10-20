# How AI Write remembers a story, and what the writer sees

A plain-words map of the whole story memory, from the words Adam writes to the briefing the AI writer reads, checked
against the code on main at 633757b1 (0.8.5) on 2026-10-20. Sections 2, 3 and 5 describe it with that day's fixes in;
section 4 shows the green-jumper case before and after them. Each part names the files that do it. The last two sections
say how it is meant to work for a standing rule ("from now on Mary wears only the green jumper") and for an event,
and where it falls short today.

## 1. The big picture

```
 Adam's words in a scene
        │  (30 s after typing stops, on leaving the scene, or before a draft)
        ▼
 The memory keeper reads the scene  ──► codex entries (profiles, "what has happened")
   (keeper/, one call: facts +           who knows what, what was said (promises, threats, secrets)
    where things stand + summary)        plot threads, events, scene summary
        │                                where things stand at the scene's end (the "stage")
        ▼
 Free work, no AI call ──► the story index (who is where, wearing and holding what, since when)
   (storyIndex/, memory/)    chapter records, the calendar, chapter / story summaries
        │
        ▼
 Before a draft: catch up (earlier scenes read first, drafts always wait)
        │
        ▼
 Plan before writing (plan/) ──► the scene plan, the continuity brief, look-ups it asked for
        │
        ▼
 The briefing (ai/context.ts) ──► the writer model writes the scene
        │
        ▼
 Checks (checks/, director/) ──► issues; slips put right become "lessons" for later scenes
```

## 2. What the memory keeper keeps (the write side)

The keeper reads the new or changed paragraphs with the memory model and gives back facts, each with the exact words
that show it (`keeper/prompts.ts` `READING_SYSTEM`; one call for facts, stage and summary: `keeper/oneReading.ts`).
A fact whose words can't be found in the scene is thrown away (`keeper/apply.ts` `run.place`).

| What | Kept as | Notes and limits |
|---|---|---|
| New people, places, things | codex entries with their fields | Looks values pass the clothing filters (`memory/looks.ts`, `keeper/apply.ts` `keptLook`) |
| Changes (hurt, lost, moved, looks) | a change on the entry: a note ("lost her left hand") and, sometimes, a new field value | The prompt asks for a new field value when a change ends or sets a field for good ("a bandage off", "to wear only X from now on") |
| Details that don't change | entry fields | |
| Who knows what, wrong beliefs | knowledge changes | The keeper is shown at most 40 known facts (`keeper/request.ts` `FACT_LINES`), oldest first |
| What was said | a fact the speaker and hearers know, with the spoken line | Four kinds: promise, threat, secret, and rule (an order or ban) (`retrieval/said.ts` `SAID_KINDS`) |
| Plot threads | thread entries, clues, payoffs | Promises ledger built from them (`memory/promises.ts`) |
| Events | event entries, "involved in" ties, "saw it happen" facts | Matched by name: a second "The storm" joins the first (`keeper/apply.ts` ~2023) |
| Where things stand at the scene's end | the stage: each person's place, pose, what they hold, how they are, each piece of clothing on or off; things in the place | Rules in `continuity/stagePrompt.ts`. Each value keeps its words and the scene they came from. Up to 40 people |
| Scene summary | 100 to 250 words, opening "By the end," | None under 40 words (`keeper/sceneChange.ts`) |
| Chapter, story, series summaries | built from the scene summaries plus the chapter record | Each part cut evenly when long (`keeper/summaries.ts` `fit`) |
| Chapter record | no AI: what changed, who learned what, open threads, who holds what | Small caps (`memory/snapshot.ts` `SNAPSHOT_MOST`); clothing left out (`memory/chapterRecord.ts`) |
| Story index | no AI: dated facts ("Mary: wearing green jumper, since Ch 3, Sc 2") | From the stage (`storyIndex/build.ts`); a piece stays worn until a scene says it came off |
| Lessons from checks | read from fixed or ignored issues | Not clothing or continuity slips; time and knowledge slips only for 6 scenes (`checks/lessons.ts`) |

## 3. What the writer sees (the read side)

The briefing is put together in `ai/context.ts` (`SEND_ORDER`, `prepareContext`, `finishContext`). Its size grows
with the model's reading limit (`ai/memoryRoom.ts` `memoryScale`). When room runs short, blocks are shortened and then
left out, least important first. Blocks marked *never left out* always go.

In the order sent:

1. **How to write**: style guide, Adam's own words as a voice sample.
2. **World rules** (lore marked as a hard rule), **themes**, **setting**.
3. **The story so far** (`ai/timeline.ts`): the last two chapters (more with a bigger model) scene by scene. Each older
   chapter gets one line: **the first 60 words** of its summary, up to 3 marks (deaths, departures, things changing
   hands) and up to 4 facts from its record: what happened to people (what lasts first), who learned what, threads.
4. **Earlier scenes word for word**: up to two scenes before the previous one, only with room to spare, and **never
   when there is a plan**.
5. **Plot threads**: those on the card, then other open ones.
6. **The point-of-view character**: full profile, everything that has happened to them, everything they know.
   Smaller forms keep only the last 5, 3 or 2 things that happened.
7. **Others in the scene** (on the card): full profile and all that happened to them. Short form: summary and voice
   only (no looks, no history).
8. **Relationships** among those present; **ties** to people not there (left out first).
9. **Also relevant**: entries named on the card, notes, direction or the end of the scene before; pins; what the plan
   asked for; entries found by searching the story. A character not in the scene gets who they are and how they
   look, plus the last 3 things that happened.
10. **Who knows what** (`ai/whoKnows.ts`): gaps and wrong beliefs; what non-point-of-view people know only with a
    bigger model.
11. **The continuity brief** and **look-ups** from the plan (*never left out*).
12. **The previous scene's last ~600 words**.
13. **The scene card**, **things left here** (story index).
14. **Where things stand** (the stage) as it carries into this scene (`ai/mustStay.ts` `stageInScene`):
    - the same moment: all of it;
    - later the same day: injuries, what people hold, the clothes still on (put on in any scene earlier that day, by the
      story calendar);
    - a later day or an unknown gap: injuries and what people hold only.
15. **The scene's contract** and **Must stay true** (*never left out*, at most 12 lines): who is dead, secrets, hurts,
    time since the scene before, things given away or lost, and pieces of clothing from the stage, and "X usually wears: …" for a Typical
    clothing the story set, while the stage says nothing of what they have on (`ai/mustStay.ts`).
16. **The plan**, after the closing instruction, as the start of the writer's own notes.

Where a character's profile sits, its Looks fields are headed **"Details to show now and then, not all at once"**: a
hint, not a rule (`ai/context.ts` `DETAILS_LABEL`). A Typical clothing the story set is under "Facts to keep to" instead.

### The plan before writing (`plan/`)

- **Free read:** everyone in the scene as the story index has them (including "wearing … since …"), scene gists of the
  last 2 chapters only, open threads, things left here, travel time.
- **With the continuity brief** (on by default): earlier chapters in short, the previous scene word for word (up to
  2,000 words), each person's last 6 changes, who knows what, the calendar, recent slips, 6 passages found by search.
- **Look-ups** (`ai/lookups/`): `state_of`, `where_is`, `what_happened`, `find_in_story`, `read_passage` and more.
  Only the planner can call them, never the writer, and only if the model chooses to.
- The brief is told never to keep what people wore earlier "unless where things stand says it still holds here"
  (`plan/brief.ts` `BRIEF_ASK.keep`). On a later day, what the stage says about clothing is usually blank, so the
  brief drops it.

## 4. How a standing rule should carry: "from now on Mary wears only the green jumper"

**Meant to happen:** once the story sets a lasting rule about someone (what they wear, where they may not go, what
they must always do), every later scene with them keeps to it until the story changes it.

**Before the fix**, for a Ch 4 scene on a later day with Mary on the card:

| Route | Carries the jumper? | Why |
|---|---|---|
| Where things stand | No | Clothes are a moment's fact. They are dropped on a later day, and, by a bug, two scenes after they were first described even when the action runs straight on (finding 1 below) |
| Must stay true | No | Clothing from the stage is dropped on a later day; Typical clothing is never listed |
| Profile's Typical clothing | Only by luck | The keeper is asked to set it only when something *ends*, so a new rule usually leaves the old clothing in the profile. When it is set, common wordings ("nothing but the green jumper") are thrown away as undressed. When it survives, it is headed "show now and then" |
| What has happened to Mary | Partly | A note "told to wear only the green jumper" is kept. Shown in full only while Mary is the point of view or on the card and room allows; smaller forms keep only the last few |
| What was said | Only if spoken as a promise or threat | An order or ban isn't one of the three kinds |
| Story index | Planner only | "Mary: wearing green jumper (since Ch 3, Sc 2)" reaches the planner, which is told to ignore old clothing |
| Story so far | By chance | Ch 3 is one 60-word line by Ch 5 |
| Search | By chance | Only if the Ch 4 card says "jumper" |

So the writer most often saw Mary's old Typical clothing and nothing that said otherwise, and dressed her in it.

**Since the fix (2026-10-20, see "What the story sets carries on" in `docs/ARCHITECTURE.md`):**

| Route | Now |
|---|---|
| Where things stand | Clothes still on carry however many scenes ago they were put on, at the same moment and later the same day. A later day still drops them: the scene card and the profile say what she wears |
| Profile's Typical clothing | The keeper is asked to set it when a change sets what someone wears from now on. "Nothing but the green jumper" with words that it lasts is kept as "the green jumper". In the briefing it sits under "Facts to keep to" |
| Must stay true | "Mary usually wears: the green jumper (since Ch 3, Sc 2)", kept in the short form too, unless the stage already says what she has on |
| What was said | An order or ban is kept, as "Ana's order or rule to Mary" |
| Planner and brief | Told that what someone usually wears still holds on a later day |
| Story so far | An older chapter's line also lists what happened to people in it |

**A book written before the fix** keeps what the old reading left out: the memory reads a scene again only when its
words change. Right-click the scene where the rule was set (Ch 3, Sc 2) in the binder and choose **Re-read this scene**.

## 5. How an event should carry: something that happened in Ch 3, needed in Ch 5

**Meant to happen:** what happened stays known to the writer for as long as it matters, in the words that matter.

**Today:** the event is kept well (an event entry, "saw it happen" facts, the people's "what has happened" notes, the
scene summary). It reaches a Ch 5 writer through:
- the point of view's "what they know" (in full);
- the "what has happened" of those on the card;
- the story so far, where Ch 3 is now one line made of the first 60 words of its summary, plus up to 4 facts from its
  record (what happened to people, what lasts first), so events told later in that summary are no longer all cut;
- the event's own entry, only when the card, notes or beats name it, or search finds it;
- the plan's brief (earlier chapters in short) and its look-ups, if the planner asks.

Weak spots: a summary's middle is cut away, the planner's free read covers only the last 2 chapters, and shared
history between two people who are both in the scene is never shown (only ties to people not there).

## 6. Tests that cover this

No test sets a standing rule in one chapter and checks a scene chapters and days later. The closest are the Gannet
jacket trap (`tests/traps/story.ts`; the scene just before restates the jacket), the book's pigeon rule
(`tests/traps/book.ts`, not about looks) and `tests/unit/memoryState.test.ts` (Typical clothing changed for good,
memory only, not what the writer is sent). Since the fix, `src/main/keeper/lastingLooks.test.ts` reads an order with the
fake memory model and checks the briefing of a scene in the next chapter, three days later.
