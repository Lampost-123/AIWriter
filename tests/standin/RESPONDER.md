# Playing the stand-in model

The stand-in model lets the app's AI work be tested with no provider, no key and no cost. The app sends its requests
to a local server (`server.mjs`), which saves each one in a folder and waits. A Claude helper, working at medium
effort, reads each request and writes the reply the app's model would write. Use it for short, targeted runs (a few
scenes, one chapter plan, one check): every request is read in full by the helper, so a long run costs the helper's
own usage.

It never uses Adam's stories. Runs use the trap harness's invented story (`tests/traps/story-v3.json` or the book).

## Starting a run

```bash
# 1. The harness, against the stand-in (it starts the server itself):
npm run traps -- --standin <folder> --samples 1 --out <report folder>

# Or the server alone, for a test of your own:
node tests/standin/server.mjs --dir <folder> --port 4646
```

## The helper's loop

1. Run `node tests/standin/next.mjs <folder>`. It waits for the next unanswered request and prints it: a header
   (job, size, reply limit, tools), the tools on offer, then every message.
2. Write the reply as JSON to `<folder>/outbox/<id>.json`:
   - words: `{ "content": "..." }`
   - tool calls: `{ "tool_calls": [{ "name": "state_of", "arguments": { "who": "Mara" } }] }`
   - a failure, to test the app's error handling: `{ "error": "..." }`
3. Go back to step 1 until it prints `none` or the run ends.

## How to answer

- Answer as a capable but ordinary writing model would. Do what the system prompt and the last message ask, in the
  format they ask for. When a reply must be JSON, send only that JSON in `content`, with nothing around it.
- Keep within the reply limit (about 4 characters a token). Draft prose at the length asked for.
- Use the tools on offer when the request needs facts the briefing doesn't hold, as a model would. With
  `TOOL CHOICE: "none"` the tools are only listed (the planner's answering request keeps them so a provider's cache
  holds): call none, and answer in words.
- Don't fix the app's mistakes for it. If the briefing leaves something out, write as a model would without it, and
  note the gap in the run notes rather than in the reply.
- Never read anything except the requests printed by `next.mjs`.

## What a run shows

`<folder>/log.jsonl` has one line per request: what job it was, how many messages, the estimated tokens sent, the tools
on offer, the reply limit, how long it waited, and the reply's size. That shows how much the app sends for each job,
whoever answers it.
