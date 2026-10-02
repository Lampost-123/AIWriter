// Fake replies for the ask part's AI calls (system prompts starting "[AIWRITE-ASK v1] <job>").
// The ask part fills this in and documents each job's reply here. Returns null for any other request.
export function askReply(system, _messages, _model) {
  if (!system.startsWith('[AIWRITE-ASK v1]')) return null
  return null
}
