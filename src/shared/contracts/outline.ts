// The outline helper and next scene ideas (milestone 4). From a premise, the AI suggests acts, chapters
// and scene cards that Adam keeps, edits or discards one by one (nothing is added without a click); on an
// empty scene card, it offers three directions for the scene. Acts appear in the binder from here on.
// Owned by the Outline part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Calls are 'outline' and 'ideas' generation records run by the shared task runner (task:* events) with
// the "Chat and brainstorm" model (jobModel('chat')). Acts use the `acts` table and chapters.act_id,
// which migration 2 already made.

export interface OutlineApi {
  // The Outline part adds its calls here (acts, the outline helper, next scene ideas).
}

export interface OutlineEvents {
  // The Outline part adds its events here, if it needs any beyond the task events.
}
