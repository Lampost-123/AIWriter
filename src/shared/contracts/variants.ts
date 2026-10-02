// Variants (milestone 4): 2 or 3 drafts of a scene written side by side; Adam picks one, or takes
// paragraphs from each. Owned by the Variants part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each variant is a 'draft' generation record with `params.variant` ({ setId, index, of }), written with
// the shared draft runner (startDraftJob with exclusive: false), so its text arrives as
// 'generation:chunk' events and it ends with 'generation:done'. Variants never go into the page until
// Adam picks, and unchosen ones never reach the memory (it reads only the scene's text).

export interface VariantsApi {
  // The Variants part adds its calls here.
}

export interface VariantsEvents {
  // The Variants part adds its events here, if it needs any beyond the generation events.
}
