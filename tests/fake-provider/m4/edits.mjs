// Fake replies for the edits part's AI calls (system prompts starting "[AIWRITE-EDIT v1] <job>").
// The edits part fills this in and documents each job's reply here. Returns null for any other request.
export function editsReply(system, _messages, _model) {
  if (!system.startsWith('[AIWRITE-EDIT v1]')) return null
  return null
}
