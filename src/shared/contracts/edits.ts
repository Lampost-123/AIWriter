// The AI tools for selected words (milestone 4, "Editing with AI"): Rewrite with an instruction,
// Expand, Condense, More vivid, Change tone, Fix voice, Alternatives, and Continue from the cursor.
// Owned by the AI edits part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each call is an 'edit' generation record with `params.tool`, run by the shared task runner (task:*
// events). Its result shows in the page as a tracked change (old words struck through, new words
// highlighted) with Accept and Reject; nothing changes in the scene until Accept, which is one step
// Ctrl+Z takes back.

export interface EditsApi {
  // The AI edits part adds its calls here.
}

export interface EditsEvents {
  // The AI edits part adds its events here, if it needs any beyond the task events.
}
