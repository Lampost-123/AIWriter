# Story memory and checks

The memory is what lets AI Write handle long stories. It knows who is where, who knows what, what has happened
and what must never happen, and it gives the AI just the parts that matter before every scene. This page explains
how the memory keeps itself up to date, how to see and correct it, and how AI Write checks your story for slips.

## How the memory keeps up

You don't need to do anything. As you write, AI Write reads your scenes and updates the memory:

- after you stop typing for a little while,
- when you leave a scene,
- when you **Mark done** a scene (Ctrl+Enter),
- and when AI Write starts, for anything it missed.

It uses the **Memory model** you chose in **Settings › Models**. The top bar shows what it's doing:
**Reading the scene…**, then **Memory updated**. Click that to see what changed.

The memory adds what your story says, such as a character's new scar, a place they've been, or something they've
just found out. It never overwrites what you typed into an entry yourself.

## See and undo what the memory changed

**What changed** lists everything the memory has done, newest first, grouped by the scene it read. Each line says
**Added**, **Changed** or **Removed**, and shows the words in your story it came from.

- Click **Undo** on any line to reverse it. The memory won't add it again from the same words.
- Sometimes the memory asks you a question, for example when your story seems to disagree with something you wrote
  in an entry. Answer it right there.

Open it from **Check** on the left, or by clicking **Memory updated** in the top bar.

## Recall: where things stand

Recall answers the questions that trip up long stories: Is Wren still holding the lamp? Did she take her boots off?
Is the door barred?

1. Open a scene and click the **Cast** tab in the scene panel.
2. Scroll to Recall at the bottom.
3. Choose **Scene end** to see how things stand as the scene ends, or **At the cursor** and click anywhere in the
   scene's words to see how things stand at that point.

For each character, Recall shows where they are, their position, what they're holding and wearing, their condition,
their mood, and what they last did. For the scene, it shows the time, the weather, the light and the things here
(such as "the door: barred from inside").

Click any value to correct it. If it's out of date, click **Read again** to have the scene read again. At the
cursor, **Work it out here** reads the words up to that exact point. The AI is
given these facts before it writes, so a character who took her boots off by the door doesn't walk out in them.

<p align="center"><img src="../images/story-memory.png" alt="Recall in the Cast tab" width="700"></p>

## See and steer what the AI is given

The **Context** tab shows the exact briefing the next draft of this scene would get: which entries, which earlier
passages, the summary of the story so far.

- **Leave out of this scene** drops something the AI doesn't need.
- **Pin for this scene**, **Pin for this story** or **Pin for every scene** makes sure something is always included.

## Summaries at every level

When a scene is marked done, AI Write writes its summary. Chapters and the whole story get summaries too. The AI
reads these to remember the story so far without rereading every word, which keeps long books fast and affordable.
You can edit any summary.

## Live checks as you type

Some checks run all the time, with no AI and no cost. They underline:

- **Name spelling**: a name that's almost, but not quite, one in your world.
- **Phrase to avoid**: anything on your style guide's **Phrases to avoid** list.
- **Common AI phrase**: stock phrases AI tends to overuse.
- **Repeated nearby**: the same word used too close together.

Click the underline to see the card, then **Fix** (or **Rewrite**, where the AI rewrites the sentence for you to
accept or reject), or **Ignore** if it's meant to be that way.

## AI consistency checks

Deeper checks compare a scene with the memory. They look at:

- **Facts**: does anything contradict what's already established?
- **Who knows what**: does a character know something they haven't found out yet?
- **Timeline and place**: could they really be here, at this time?
- **Voice** and **Style and tone**: does everyone sound like themselves?

They run by themselves shortly after a draft and when you mark a scene done. To check by hand, use
**Check this scene**, **Check this chapter** or **Check this story** (from the binder, the Issues tab, or search with
Ctrl+K). They use the **Consistency check model**.

### Fix what's found

The **Issues** tab in the scene panel lists the scene's open issues. The binder shows a small badge on scenes that
have them. For each issue:

- **Fix the text** asks the AI to rewrite the sentence, shown in the page for you to accept or reject. If a fix is
  already suggested, the button says **Review the fix**.
- **Update the memory**, when it's the memory that's wrong, not the story.
- **Ignore** hides it if it's meant to be like this. It won't be raised again.

### The Consistency page

The **Consistency** page (under **Check** on the left) shows every issue in the story, chapter by chapter, marked
**Must fix**, **Worth a look** or **Minor**. Its tabs are **Issues**, **Repetition** and **Plot threads**. Turn on
**Voice and style too** for a fuller check; it's slower, and costs more.

<p align="center"><img src="../images/consistency.png" alt="The Consistency page" width="800"></p>

## Ask the world

**Ask the world** is a chat beside the page that answers from your story's memory. Open it with **Ask** on the left,
the **Ask the world** button in the top bar, or select some words and click **Ask about this**.

Try questions like:

- "What does Wren know about the letter by the end of chapter one?"
- "Who has been to the Drowned Steps?"
- "Give me three reasons Ansel might keep the letter from Edric."

It can also suggest changes, such as a new entry or a fix to one. They're listed with
"nothing changes until you apply". Click **Apply** on the ones you want, **Not this** on the ones you don't, or
**Apply all**. Every change can be undone. Ask the world never deletes anything.

It uses the **Chat and brainstorm model**.

<p align="center"><img src="../images/ask.png" alt="Ask the world beside the page" width="700"></p>

---

**Next:** [Planning](planning.md)
