# Troubleshooting

Something not working? Most problems come from the AI service: a key, credit, or a model that isn't available.
AI Write says what went wrong in plain words and what to try next. This page lists the common messages and a few
other things worth knowing.

First, two things that are always true:

- **Your writing is safe.** AI Write saves as you type. If a draft stops halfway, the text that arrived is kept.
- **Almost everything can be undone.** Ctrl+Z, the **Undo** in each message, **History** for a scene, and
  **Settings › Recently deleted** for 30 days.

## Installing

**Windows says "Windows protected your PC".**
The installer isn't code-signed yet, so Windows doesn't recognise it. Click **More info**, then **Run anyway**.

**My browser says the file isn't commonly downloaded.**
Choose **Keep**. Only download AI Write from the
[releases page](https://github.com/Lampost-123/AIWriter/releases/latest).

**Is there a version for Mac or Linux?**
No. AI Write runs on Windows 10 or 11, 64-bit.

## Connecting to an AI service

Use **Test connection** (for OpenRouter) or **Test** (for another provider) in **Settings › Models** to check a
connection at any time.

| What AI Write says | What to do |
|---|---|
| "OpenRouter didn't accept this key." | Copy the key again from [openrouter.ai/keys](https://openrouter.ai/keys) and click **Replace key**. |
| A service "didn't accept your API key" or "needs an API key" | Open **Settings › Models**, click **Edit** on that provider, and paste the key again. |
| "Your OpenRouter credit has run out." | Top up at [openrouter.ai/credits](https://openrouter.ai/credits), then try again. |
| "Couldn't find …" or "Couldn't connect to …" | Check your internet connection. For another provider, check its **Base URL**; it usually ends in `/v1`. |
| "Couldn't reach … If it runs on this computer (like LM Studio or Ollama) …" | Open LM Studio or Ollama and make sure its server is started. |

## When the AI is writing

| What AI Write says | What to do |
|---|---|
| "This model is busy right now." | Wait a minute and try again, or pick another model. |
| "This model refused the scene." or "turned the request down" | Some models refuse certain content. Try another model in **Settings › Models**. |
| "The writer model used up its room thinking and wrote nothing." | Try again, or set the writer's **Thinking** lower (or **Off**) in **Settings › Models**. |
| "The briefing and the length you asked for are too much for this model together." | Lower the **Length** in the draft options, shorten the scene card, or pick a model that can read more. |
| "The connection … dropped before the draft was finished. The text that arrived is kept." | Click **Continue** or **Add below** in the AI dock to carry on, or try again later. |
| "This model can't use the tools the editor chat needs …" | Ask the world needs a model that can use tools. Choose another **Chat and brainstorm model**; most Claude, GPT, DeepSeek and Gemini models can. |

**Drafts don't sound like me.**
Put a paragraph of your own writing in the style guide's **Sample passage**, and describe your **Prose style**.
A different writer model can make a big difference too. See [Planning](planning.md#set-the-style).

**The AI got a fact wrong.**
Check the entry in your world. If the entry is wrong, correct it, and the AI will use it from the next draft on.
If the entry is right, use **Check this scene** and **Fix the text** on the issue it finds. The **Context** tab shows
what the AI is given, and you can pin anything it keeps missing.

## The memory

**The top bar says "Memory isn't updating".**
Click it to see why. It's usually the AI service (a key, credit, or a model). Your writing is safe, and the memory
catches up with every scene once it's sorted.

**The memory added something wrong.**
Open **What changed** and click **Undo** on that line. The memory won't add it again from the same words.

**I reached my monthly limit.**
AI Write asks before starting anything new and pauses memory updates. Choose **Carry on this month** to carry on,
or change the limit in **Settings › Usage and cost**.

## Read aloud and dictation

**The voices won't download.**
They need an NVIDIA graphics card (RTX 20 series or newer) with at least 10 GB of memory, and about 15 GB of free
disk space. AI Write checks before downloading and says what's missing.

**The speech engine won't start.**
It needs Python 3.10 to 3.13. Click **Install Python** in **Settings › Read aloud and dictation**, or install
Python 3.13 from [python.org](https://www.python.org) (tick "Add python.exe to PATH"), then try again.

**The sound effects won't download.**
Make sure you've accepted the Stable Audio Open licence on Hugging Face with the same account your key is from.

## Updates

AI Write checks for updates when it starts and every few hours, and asks before restarting. To check by hand, open
**Settings › About and updates** and click **Check for updates**.

If updates aren't working, download the newest installer from the
[releases page](https://github.com/Lampost-123/AIWriter/releases/latest) and run it. Your worlds, settings and keys
are kept.

## Getting your work back

- **Undo something just now**: Ctrl+Z, or the **Undo** in the message.
- **An earlier version of a scene**: **History**, then **Restore this version**.
- **A deleted scene, chapter or entry**: **Settings › Recently deleted**, then **Restore** (for 30 days).
- **A deleted world**: Recently deleted at the foot of the start screen (for 30 days).
- **Go back to an earlier day**: **Settings › Backups**, then **Restore**. Your current work is backed up first.

## Still stuck?

[Open an issue on GitHub](https://github.com/Lampost-123/AIWriter/issues/new/choose) and say what you were doing,
what you expected, and what happened. Your AI Write version is in **Settings › About and updates**. Please don't
include your API key or any writing you don't want to share.

---

**Back to:** [the guide's contents](README.md)
