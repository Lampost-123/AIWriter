# Build with AI, cleaner and easier to get around (spec, 2026-10-20)

Adam: "make the AI story building page more usable and clean. Currently it's kind of confusing with stuff locked behind
other sections and it's hard to navigate and have it do what I want."

This spec says what changes on the Build with AI page (View `planHub`, `src/renderer/src/features/planHub/`). It does not
add new AI jobs or change what any AI job does. Nothing Adam has made changes: the same stores, the same sessions.

## What is wrong now (seen in the app, sample world, fake AI)

1. **One long page.** Your idea, Cast and world, The story line and Threads sit one under another. Your idea alone is
   taller than the window (idea, where and when, length, must happen, characters, questions, style, recipe), and Cast
   and world is taller again (the cast plan, Interview me topic by topic, In your world). To reach the story line Adam
   scrolls past both, or uses the strip at the top, which only scrolls the page and guesses which section is "in view".
2. **The same title three times.** "Plan", then "Build “The Keeper’s Light” with AI", then the strip's "3 The story line ·
   Ch 1–2 written", then the section's own head "3 The story line · Ch 1–2 written" again.
3. **Zooming in hides the way around.** On a chapter's or a scene's page the strip of sections disappears; the only way
   out is the small "Whole story" link in the trail.
4. **Planned chapters are hidden inside a wrapper.** Mid-story the planned chapters sit under a row "Ch 3 · planned, not
   written" with its own Write Ch 3 and Fold away (or "Pick up from here"), and inside it the same chapter again with its
   own Plan it. Two buttons for the same chapter, one level down.
5. **Things locked behind other sections.**
   - "How it all connects" can't be pressed until an interview has kept something, even when the world already has
     people and places to connect ("After you keep something").
   - A new story's "Plan it" with no idea yet throws Adam back up to Your idea, and its "Write your idea" link does the
     same: the idea can't be written where the button is.
6. **The side column is the same everywhere.** "Plan before writing" (a writing setting) sits beside Your idea, Cast and
   world and Threads, where it means nothing.

## What it becomes

### 1. Tabs, one section at a time

- Under the page title, the four sections are **tabs**: Your idea, Cast and world, Story line, Threads. Each tab keeps
  its number and how it stands ("written", "4 people, 3 places", "Ch 1–2 written, Ch 3 planned", "1 open").
- Only the chosen tab's section shows. Nothing scrolls to find a section, and nothing guesses which is in view.
- The tab is part of the view (`View.planHub.section`), so every way in that names a section still lands on it. With no
  section named, the page opens at the tab Adam last used for this story while the app runs (`hubStore` `section`),
  else where the story stands (`defaultSection`: Your idea for a blank story, Story line otherwise).
- Keyboard: the tabs are a real tab list (arrow keys move between them, Enter or Space picks one; Home and End).
- Buttons that pointed at another section switch tab instead of scrolling: "Write your idea" / "Change it", "Plan the
  cast and world" / "See them", "Plan its payoff" (to Story line with the box focused), Cast and world's "write your
  idea" link.
- The section's own repeated head (number, title, status) is removed; the tab says it.
- The tab change is instant (it is a click that changes what is shown, like switching scenes); the panel does not slide.

### 2. The tabs stay when zoomed in

- A chapter's page and a scene's page show under the same tabs, with Story line chosen. Clicking Story line goes back to
  the whole story line (with that chapter's row in view, as Whole story does now); clicking another tab goes there.
- The trail ("Whole story › Ch 3 · The Bell Tower") stays as it is.

### 3. Planned chapters in plain sight

- Mid-story and in a planned story, the planned chapters are listed straight in the story line, one row each (name, how
  many scenes, the goal, the one next step, the fold for its scenes), under YOU ARE HERE. No wrapper row, no "Open the
  plan", "Pick up from here" or "Fold away" around them, no second "Write Ch N" (each chapter's own Write it does that).
- Written chapters stay folded together ("Ch 1 · written · Open") as now: they are done, and can be long.
- Acts with no chapters, batches arriving in their place, Show me and the drift notes behave as now.

### 4. Nothing locked behind another section

- **How it all connects** can be started as soon as the world has at least one character, place or piece of lore (from
  anywhere: kept from an interview, built, or written by hand), not only after an interview kept something. With an
  empty world it stays shut and says "Add a character, place or lore first".
- **A new story's Plan your story card** has the idea box itself (the same field as Your idea: the brief's plot), so Adam
  writes the idea right there and presses Plan it. With the box empty, Plan it says what to do under the box and puts
  the cursor in it; it does not leave the tab. The cast and world line keeps its link, which switches tab.

### 5. The side column fits the tab

- **Talk it over** stays beside every tab, about that tab, as now.
- **Plan before writing** shows only on Story line (and the chapter's and scene's pages), where drafts are started.

## What does not change

- The AI jobs, their prompts, the stores, the sessions, Keep / Change / Discard / Undo, What the AI saw.
- The zoomed pages' own contents (Write this chapter, Plan with AI, the scene tools).
- Every older way in (`buildRoute`, `openPlanHub`, `openChapterPage`, `openScenePage`, ...) and where it lands.
- The Plan area's links outside the page (Story board, Plan a chapter, Plot threads board, Story recipes).
- The World builder page.

## Done looks like

- Opening Build with AI shows one section, with the tabs and their statuses above it; switching tabs never scrolls.
- On a chapter's page the tabs are still there and get Adam back to the story line or anywhere else in one click.
- A planned chapter has one row with one next step, visible without opening anything.
- How it all connects opens in the sample world with no interview done.
- A new story can be planned from the Story line tab without leaving it.
- Plan before writing is not shown on Your idea, Cast and world or Threads.
- Typecheck, unit tests and the e2e specs that use the page pass; pictures (`BUILD_SHOTS`, `ZOOM_SHOTS`) taken after.

## Decisions taken without Adam (to correct if wrong)

- Tabs rather than folding sections: folding still leaves one long page and keeps the guessing strip.
- The written chapters stay folded; only planned ones are opened up.
- No change to the Plan area's own list of links (it has "Next scene ideas", "Interview me" and "Plan a chapter" that
  overlap the page); that is a separate tidy-up if Adam wants it.
