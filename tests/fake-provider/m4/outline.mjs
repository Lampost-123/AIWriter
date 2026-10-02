// Fake replies for the outline part's AI calls (system prompts starting "[AIWRITE-OUTLINE v1] <job>").
// The outline part fills this in and documents each job's reply here. Returns null for any other request.
export function outlineReply(system, _messages, _model) {
  if (!system.startsWith('[AIWRITE-OUTLINE v1]')) return null
  return null
}
