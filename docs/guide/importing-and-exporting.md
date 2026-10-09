# Importing and exporting

This page covers bringing a book you've already written into AI Write, exporting your story to share or publish,
moving a whole world to another computer, and keeping your work safe with backups.

## Import a manuscript

You can bring in a book from Word (`.docx`), Markdown (`.md`) or plain text (`.txt`).

1. Choose **Import a manuscript…** from the story menu (the arrow beside the story's name in the top bar), or from the start
   screen.
2. Click **Choose a file…** and pick your book.
3. AI Write finds the chapter and scene breaks for you. Check them: each break can be changed to an **Act**, a
   **Chapter** or a **Scene**, or marked as not a break at all. **Undo my changes** puts the breaks back as they were found.
4. Click **Import**. Your book appears in the binder as chapters and scenes.

Changed your mind? The message that confirms the import has an **Undo**.

### Build the memory from it

An imported book starts with an empty memory. To have AI Write read it and fill in your world:

1. After the import, click **Build the memory**. (Later, it's in the story menu as
   **Build the memory from this story**.)
2. AI Write reads the book scene by scene in the background, adding the characters, places and facts it finds.
   You can keep writing while it works.
3. When it's done, look through **What changed** to see what it learned.

> **Tip:** reading a whole book uses your **Memory model** for every scene, so a long book costs more than a single
> draft. A fast, cheaper memory model keeps this low. See [AI services and models](ai-providers.md#keep-an-eye-on-cost).

## Export your story

1. Open the story menu (the arrow beside the story's name in the top bar) and choose **Export story…**.
2. Under **What to export**, choose **Whole story**, **One chapter**, or **Choose…** to pick chapters and scenes.
3. Choose a **Format**:
   - **Word**: a `.docx` to edit or send to an editor.
   - **EPUB**: an e-book for e-readers and phones.
   - **PDF**: laid out like a book, to read or print.
   - **Markdown**: a `.md` file, with italics and bold kept.
   - **Plain text**: just the words.
4. Click **Export…** and choose where to save it. **Show in folder** takes you to the file.

## Export a series bible

A series bible is every character, place, piece of lore, event and plot thread in your world, written up as a
reference.

1. Open the story menu and choose **Export series bible…**.
2. Under **As of the end of**, pick a story. Each entry is shown as it stands when that story ends.
3. Choose **PDF** or **Markdown**, then click **Export…**.

## Move a world to another computer

A world file (`.aiwrite`) holds a whole world: every story, entry, picture and its history. It never includes your
API keys or backups.

**To export:** on the start screen, open a world's menu and choose **Export world…**. (With a world open, search
for **Export world** with Ctrl+K.)

**To import:** choose **Import a world file…** on the start screen, and pick the `.aiwrite` file.

**To copy a world** on the same computer, for example to try something risky, choose **Make a copy** from its menu.

> **Tip:** each world is also just a folder inside your library folder (`Documents\AI Write` unless you moved it).
> Copying the folder works too.

## Backups

AI Write backs up the open world when you open it and every 30 minutes while you write. The last 20 backups are
kept, plus one a day for 30 days.

- **Settings › Backups** lists them. Click **Back up now** to make one straight away.
- To go back to a backup, click **Restore** beside it. Your current work is backed up first, so you can undo this.
- **Second backup folder** keeps a copy of every backup somewhere else too, such as a Dropbox, OneDrive or iCloud
  folder, so your writing is safe even if something happens to this computer. Click **Choose folder…** to set one.

Backups never contain your API keys.

## Recently deleted

Every delete shows an **Undo** straight away. After that:

- Deleted scenes, chapters and entries stay in **Settings › Recently deleted** for 30 days. Click **Restore** to bring
  one back.
- Deleted worlds are listed under Recently deleted at the foot of the start screen, also for 30 days.

## Where your files live

| What | Where |
|---|---|
| Your worlds (the library folder) | `Documents\AI Write`, unless you chose another folder |
| Each world's backups | A `backups` folder inside that world's folder |
| Settings, encrypted keys, speech downloads | `%APPDATA%\AI Write` |

To see or move the library folder, open **Settings › About and updates** and use **Open folder** or
**Change folder…** under **Library folder**.

---

**Next:** [Making it yours](customising.md)
