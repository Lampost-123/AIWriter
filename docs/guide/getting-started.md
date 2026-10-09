# Getting started

This page takes you from download to your first finished scene. It takes about ten minutes, most of it
spent on making a key with an AI service.

## Install AI Write

AI Write runs on **Windows 10 or 11, 64-bit**.

1. Go to the [latest release](https://github.com/Lampost-123/AIWriter/releases/latest) and download
   `AI-Write-Setup-<version>.exe`. Your browser may say the file isn't commonly downloaded. Choose **Keep**.
2. Double-click the file.
3. Windows may show a blue screen that says "Windows protected your PC". This is because the installer isn't
   code-signed yet. Click **More info**, then **Run anyway**. You only see this once: later versions install
   themselves.
4. AI Write installs for your Windows account (there's no admin prompt) and opens straight away. Next time,
   open it from the Start menu or the desktop shortcut.

## Set up in five steps

The first time AI Write opens, it shows **Welcome to AI Write** and a few short steps. Everything saves as you go,
and you can change all of it later in Settings.

### 1. Name your world

A world holds the characters, places and lore for one setting, and every story you set there.

1. Type a name under **World name**.
2. Click **Continue**.

Not sure yet? Click **Explore a sample world first**. It opens Gullhaven, a short finished story with its
characters, places and memory filled in, so you can look round before you start your own. Nothing in it costs
anything. You can come back to set up your own world whenever you're ready.

### 2. Connect an AI service

AI Write doesn't include an AI of its own. You connect one, and pay that service for what you use.
**We recommend DeepSeek**: it writes good prose for long stories and costs very little. There are two easy ways in.

**DeepSeek directly** (usually the cheapest):

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com) and add a little credit. A few dollars goes a
   long way.
2. Create an API key and copy it.
3. Back in AI Write, click **DeepSeek** (under "Or use another service, or models running on this computer"),
   paste the key and click **Add provider**.

**Or OpenRouter**, where one key reaches DeepSeek and hundreds of other models:

1. Sign up at [openrouter.ai](https://openrouter.ai) and add a little credit.
2. Under **Keys**, create a key and copy it.
3. Back in AI Write, paste the key under **API key** and click **Connect**. AI Write tests it straight away.

<p align="center"><img src="../images/setup.png" alt="The setup's Connect step: OpenRouter, or another service such as DeepSeek" width="800"></p>

The same row has OpenAI, Mistral, Groq, LM Studio and Ollama, and **Use another provider** works for any other service. See
[AI services and models](ai-providers.md) for the details. You can also click **Skip for now** and connect later
in **Settings › Models**.

### 3. Pick a writer model

The writer model is the AI that drafts your scenes. AI Write lists the models your service offers, with what each
costs. We recommend **DeepSeek Flash**: when your service offers it, AI Write marks it **Recommended**. Click
**Use this** beside the one you want. You can switch any time, so
don't worry about choosing perfectly.

### 4. How should your stories read?

Tell the AI how you like to write: point of view, tense, spelling, the feel of your prose. These become your own
writing preferences for every world. Each world and story can change them later in its style guide. Click
**Continue** when you're done.

### 5. Lay out your world (optional)

- **Describe my world** opens the World builder. Type or paste a description of your world, from a paragraph to a
  few pages, and the AI lays out its characters, places, lore and plot threads for you. See
  [Your world](your-world.md#build-a-world-from-a-summary).
- **Start writing** opens your first scene, with a short guide to writing it.

## Find your way around

<p align="center"><img src="../images/hero.png" alt="The desk: the story's spine, the page and the AI dock" width="800"></p>

AI Write opens on **the desk**:

- **The rooms**, in the middle of the top bar: **Write** (the page, the style guide and the story's settings),
  **Plan** (the story board, the outline helper, plot threads and recipes), **World** (everything in your world,
  the relationship map and the timeline) and **Check** (consistency, what the memory changed, and this scene's
  issues). Each room has a row of links at its top right.
- **The story's spine** on the left lists your chapters and scenes (the binder). Click a scene to open it. The arrow
  at its top folds it to a slim spine; click the spine to see every scene again.
- **The page** in the middle is where you write. Under the title, **Scene details** opens the scene panel.
- **The AI dock** at the foot of the page: **Continue**, **Add below**, and **More** for every other way to write,
  the scene's tools and **Ask the world**.
- **The scene panel** comes in from the right (**Scene details** in the top bar, or under the title). It has tabs:
  **Scene card**, **Context**, **Cast**, **Issues** and **Drafts**.
- **The top bar** also has the world and story names, **Search**, **Saved** with the scene's word count,
  **Focus mode** and **Settings**. The arrow beside the story's name is the story menu: other stories,
  **Story settings**, **Export story…** and more. The lamp at the top left, or the story's name, opens the
  **story home**: the book, its chapters, open threads, the cast and this week's writing.
- **Search** with Ctrl+K finds anything: a scene, a character, or an action like "Export story". If you
  forget where something is, this is the quickest way to it.
- Press **?** (when you're not typing) to see every keyboard shortcut.

If you'd rather have the areas down the left and the scene panel always beside the page, choose **Panels** in
**Settings › Appearance › Layout**. In the **Classic** look, the same places are listed in the binder instead.

## Write your first scene

The loop is: card, draft, edit, done.

1. **Fill in the scene card**: click **Scene details** under the scene's title. Choose the **Point of view** character, add **Characters present**,
   pick a **Location**, and write a few **Beats** saying what should happen. In Gullhaven, the first scene,
   "Lighting the Lamp", has Wren climbing the hundred and twelve steps to the lamp room at dusk.
2. **Click Draft the scene** in the AI dock (or press Ctrl+G). The AI drafts the scene from its card and your world.
   Read along as it writes. Click **Stop** or press Esc to stop it; the text so far is kept. Once the scene has words,
   the dock's button says **Continue** (Ctrl+Shift+Enter) and writes on from the end.
3. **Make it yours.** Change anything you like. AI Write saves as you type, and the memory keeps up.
4. **Mark it done** (Ctrl+Enter, or **More** › **Mark done** in the dock) when you're happy with it. AI Write reads the scene,
   updates the memory, and checks it against the rest of your story.

> **Tip:** you don't have to fill in every box on the scene card. A point of view, a place and one or two beats
> are plenty. Leave **Length** on Auto and the AI picks the length the scene needs.

## Come back later

When you open AI Write again, the start screen shows **Continue where you left off** at the top. Press Enter to
jump straight back in. Below it you'll find all your worlds and stories, and buttons for a **New world**,
**New story…** and, once you've made a recipe, **New story from a recipe…**.

<p align="center"><img src="../images/start-screen.png" alt="The start screen" width="700"></p>

## Updates

AI Write checks for a new version when it starts, downloads it in the background, and tells you when it's
ready. Click **Restart to update** when it suits you. It never restarts by itself, and your worlds, settings and
keys are kept. You can also check by hand in **Settings › About and updates** with **Check for updates**.

## Uninstall

Uninstall AI Write from Windows Settings, under Apps. Your worlds stay in your `Documents\AI Write` folder, so if
you install it again later, everything is still there.

---

**Next:** [AI services and models](ai-providers.md)
