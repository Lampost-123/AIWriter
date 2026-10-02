// Fake replies for the readAloud part's AI calls (system prompts starting "[AIWRITE-READ-ALOUD v1] <job>").
// The readAloud part fills this in and documents each job's reply here. Returns null for any other request.
export function readAloudReply(system, _messages, _model) {
  if (!system.startsWith('[AIWRITE-READ-ALOUD v1]')) return null
  return null
}
