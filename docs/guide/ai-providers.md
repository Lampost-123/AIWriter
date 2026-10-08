# AI services and models

AI Write doesn't come with an AI of its own. You connect an AI service, choose which of its models to use,
and pay the service for what you use. This page shows how to connect one, which model to use for what, and
how to keep an eye on the cost.

Everything here is in **Settings › Models** (Ctrl+, opens it).

<p align="center"><img src="../images/settings-ai.png" alt="Settings, Models: connect OpenRouter or another provider, and pick the writer model" width="800"></p>

## Connect OpenRouter (recommended)

OpenRouter gives you hundreds of models from different makers with one key, each with its price shown up front.

1. Sign up at [openrouter.ai](https://openrouter.ai) and add a little credit.
2. Make a key at [openrouter.ai/keys](https://openrouter.ai/keys) and copy it.
3. In AI Write, open **Settings › Models**.
4. Paste the key under **API key** and click **Connect**.

When it works you'll see **Connected**, and the line "Your key is saved on this computer, encrypted."

- **Test connection** checks the key again.
- **Replace key** lets you paste a new one.
- **Disconnect** removes it.

## Connect another service

You can use any service that works the same way as OpenAI's, including programs that run models on your own PC.

1. In **Settings › Models**, under **Other providers**, click **Add another provider**.
2. Pick one of the ready-made choices to fill in the details for you: **OpenAI**, **DeepSeek**, **Mistral**,
   **Groq**, **LM Studio** or **Ollama**. Or fill them in yourself:
   - **Name**: anything you like.
   - **Base URL**: the service's address. It usually ends in `/v1`.
   - **API key**: paste the key from your account with that service.
3. Click **Add provider**. AI Write tests it straight away.

Each provider you add has **Test**, **Edit** and **Remove** buttons.

### Run models on your own PC

LM Studio and Ollama run models on your own computer, with no cost per use and nothing sent anywhere. They need a
fairly powerful PC, and the models they can run are usually smaller than the big online ones.

1. Install LM Studio or Ollama, download a model in it, and start its server.
2. Add it with **Add another provider**, using the **LM Studio** or **Ollama** choice. Leave the key empty.

## Choose your models

AI Write uses AI for several different jobs. You choose a model for each one. Only the writer model is needed to
start; the others use another job's model until you pick one.

| Job | What it does | What kind of model |
|---|---|---|
| **Writer model** | Drafts your scenes. | The best prose you can afford. This matters most. |
| **Memory model** | Reads your scenes to keep the memory up to date. | A fast, cheaper model is fine. |
| **Character builder model** | Builds characters, places, groups and items from your notes, and answers in character in an interview. | |
| **World builder model** | Builds the world from a summary you type or paste. | |
| **Chat and brainstorm model** | Answers in Ask the world, suggests outlines, and offers ideas for the next scene. | One that can use tools: most Claude, GPT, DeepSeek and Gemini models can. |
| **Consistency check model** | Checks scenes against the memory: facts, who knows what, timeline and place, voices and style. | |
| **Recipe maker** | Makes a story recipe from a story you admire. | |
| **Read aloud model** | Suggests voices for characters and how their names are said. | A fast, cheaper model is fine. |

To choose one:

1. Find the job in **Settings › Models**. A job that has no model of its own says, for example, **Same as the writer
   model**. Click **Choose another model** (or **Change**, once it has one).
2. Search the list by name or maker. Each model shows how much it can read at once and its price per million tokens.
3. Click the one you want. **Test this model** checks that it answers.

> **Tip:** a "token" is roughly three-quarters of a word. A typical scene uses a few thousand tokens to read the
> briefing and a couple of thousand to write, so with most models a draft costs a few cents or less.

### Thinking

Some models can "think" before they answer. Each job has a **Thinking** setting: **Model decides**, **Off**,
**Low**, **Medium** or **High**. It's **Off** by default. Thinking can help a model plan a scene, but drafts take
longer and cost more. Models that don't think aren't affected.

### Default creativity

**Default creativity** sets how adventurous the writer is: **Steady**, **Balanced** (the default) or
**Adventurous**. You can change it for a single draft too (see [Writing with AI](writing-with-ai.md#draft-options)).

## Other settings on the Models page

- **Plan before writing** (on): before each draft, the memory model plans what the scene keeps to and what changes.
- **Check new words straight away** (on): after a draft, a beat or Continue, small slips are fixed in amber and
  the rest are raised for you to look at. It uses the memory model once each time.
- **Find by meaning** (on): before each draft, AI Write finds earlier scenes, facts and summaries that matter,
  by their words and also by what they mean ("her brother", "the promise at the well"). This needs a small search
  model (about 133 MB) that downloads by itself and runs on your computer. You can **Stop** the download or
  **Remove** the model here.

## Keep an eye on cost

**Settings › Usage and cost** shows what the AI has cost across every world, **By model** and **By job**.

To set a limit:

1. In **Usage and cost**, find **Monthly limit**.
2. Type an amount under **Limit in US dollars**.

AI Write lets you know as you get close. At the limit, it asks before starting anything new and pauses memory
updates, until the next month or until you choose **Carry on this month**.

> **Tip:** the biggest savings come from choosing a cheaper model for the **Memory model** and the
> **Consistency check model**, which run often. Keep your money for the **Writer model**.

## Your keys are safe

Keys are encrypted with Windows' own protection and kept in AI Write's settings folder on your PC. They are never
put in a world, a backup, a world file or an export, so you can share those safely.

## What the AI service sees

Only the service you choose, and only what each job needs: for a draft, the scene card, the parts of the memory
that matter for the scene, earlier passages it found, and your style guide. To see exactly what was sent for any
draft, open **What the AI saw** (see [Writing with AI](writing-with-ai.md#see-what-the-ai-saw)). Notes you keep under
**Private notes (never sent to the AI)** on an entry are never sent.

---

**Next:** [Writing with AI](writing-with-ai.md)
