// Ask the world (milestone 4): a chat panel for brainstorming that can see the memory, answers from it,
// cites the entries it used, and can save anything useful to the memory as Adam's own note with one
// click. It never changes the manuscript or the memory on its own. Owned by the Ask the world part.
// See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each turn is a 'chat' generation record with `params.chatId`, run by the shared task runner (task:*
// events) with the "Chat and brainstorm" model (jobModel('chat')).

export interface AskApi {
  // The Ask the world part adds its calls here.
}

export interface AskEvents {
  // The Ask the world part adds its events here, if it needs any beyond the task events.
}
