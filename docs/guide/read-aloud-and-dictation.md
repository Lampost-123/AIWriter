# Read aloud and dictation

Hearing your words read aloud is one of the best ways to catch a clumsy sentence. AI Write can read your scenes with
a narrator and a different voice for each character. It can also type what you say, so you can draft by talking.

The voices and dictation run on your own computer, so there's no cost per use. They are off until you turn them on,
and each part downloads only when you ask for it. Everything here is in **Settings › Read aloud and dictation**.

<p align="center"><img src="../images/read-aloud.png" alt="A scene being read aloud" width="800"></p>

## What you need

| Part | Download size | What it needs |
|---|---|---|
| **Speech engine** (needed for everything below) | about 150 MB | Python 3.10 to 3.13. If you don't have it, AI Write offers **Install Python**. |
| **Voices** (Breeze TTS 2) | about 12 GB | An NVIDIA graphics card, RTX 20 series or newer, with at least 8 GB of memory, and about 15 GB free while it downloads. |
| **Studio voices** (optional) | about 4 GB | Used together with the voices above. |
| **Dictation**: Parakeet or Whisper | about 1 GB or about 300 MB | Any PC. It runs on the processor. |
| **Sound effects** (optional) | about 12 GB | An NVIDIA RTX 20 series or newer card, and a free Hugging Face account. |

> **Please note:** the voices' licences are for personal, non-commercial use. The sound effects model is from
> Stability AI and has its own licence, which you accept on Hugging Face before downloading.

## Set up the speech engine

1. Open **Settings › Read aloud and dictation**.
2. Under **Speech engine**, click **Download the speech engine**.
3. If AI Write says Python is missing, click **Install Python**, then try again.

When it's running, the speech engine shows **Connected**.

## Hear a scene read aloud

### Get the voices

1. In **Settings › Read aloud and dictation**, under **Voices**, click **Download the voices**. AI Write checks your
   graphics card and disk space first and tells you if they won't fit.
2. Turn on **Read scenes aloud**.

### Listen

1. Click in a scene where you want the reading to start.
2. Click **Listen** in the toolbar, or press Ctrl+L. Press Ctrl+L again to pause and carry on.
3. Press Ctrl+Shift+Space to stop.

The sentence being read is highlighted. With **Follow along** on, the page scrolls to keep it in view. With
**Keep reading** on, it carries on into the next scene when one ends.

### Give characters their own voices

- Turn on **Give characters their own voices**. Each character's lines are read in the voice set on their page in
  your world (**Read-aloud voice**). Other quoted lines use the **Quoted dialogue** voice.
- **Describe the narrator** in a few words to shape the narrator's voice.
- **Studio voices** are 96 real voices recorded in a studio. Download them with **Download the studio voices**.
  Turn on **Act out feelings** and a character reads an angry, frightened or tender line from their own recording
  of that feeling.

### Who says what, and how

So that each line is read by the right character in the right tone, AI Write can mark who says each paragraph and
how. New drafts are marked as they're written; your own writing is marked when it's read aloud.

- **Mark who says what** turns this on. It uses your AI model (the writer model, and the **Read aloud model** for
  suggesting voices), so it sends text to your AI service like any other AI job.
- **Show speakers and tone** shows the marks in small grey words above each paragraph. They're never part of your
  text. You can also show or hide them from search (Ctrl+K).

## Talk instead of typing

1. In **Settings › Read aloud and dictation**, under **Dictation**, choose a **Dictation model**:
   **Parakeet** (sharper, about 1 GB) or **Whisper** (smaller, about 300 MB). It downloads the first time.
2. Pick a **Hold-to-talk key**: one key on its own, not a combination.
3. Click where you want the words to go: a scene, a scene card, the chat or any other text box.
4. Hold the key, talk, and let go. Your words are typed where the cursor is.

Dictation is English only.

## Add sound effects (optional)

With sound effects on, the AI adds quiet sounds under the reading: a door on the word it slams, rain while it falls.
They're made on your computer.

1. Make a free account at Hugging Face and accept the licence for Stable Audio Open.
2. Make a key there (read access is enough).
3. In AI Write, turn on **Sound effects and ambience**, paste the key, and click **Download the sound effects**.

A **Sounds** tab appears in the scene panel, and **Sounds volume** sets how loud they are under the voice.

## Where the downloads go

Speech downloads are kept in AI Write's settings folder (`%APPDATA%\AI Write\speech`), never in your worlds or
backups. **Settings › Read aloud and dictation** shows how much space they take, and lets you remove them.

---

**Next:** [Importing and exporting](importing-and-exporting.md)
