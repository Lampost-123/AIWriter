// Beat by beat (milestone 4): writes one beat of the scene card at a time and pauses, so Adam can steer
// before the next. Owned by the Beat by beat part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Each beat is a 'beat' generation record with `params.beat` ({ sessionId, index, of }), written with the
// shared draft runner (startDraftJob with job 'beat') and a briefing from draftBriefing with its own
// closing instruction and the scene so far, so it streams into the page like a draft.

export interface BeatsApi {
  // The Beat by beat part adds its calls here.
}

export interface BeatsEvents {
  // The Beat by beat part adds its events here, if it needs any beyond the generation events.
}
