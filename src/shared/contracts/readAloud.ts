// Reading aloud (milestone 4, "Read aloud and dictation"): Listen (Ctrl+L) from the cursor, the slim bar
// above the page, sentence highlight and Follow along, Keep reading, the audio cache, voices for the
// narrator and each character, "Say it as", who says each line and how, and calibration (Sample, How to
// read, speed). Owned by the Read aloud part. See docs/ARCHITECTURE.md, "Milestone 4".
//
// Character voices and "Say it as" pronunciations are kept in the world's `meta` key `read_aloud`, by
// entry id (no data model change). Speaker and tone marks are a cache per scene in the app's cache folder,
// keyed by paragraph id and a hash of its text; spoken audio too, up to the limit Adam picks. The AI calls
// are 'speech' generation records with the "Read aloud" model (jobModel('speech')).

export interface ReadAloudApi {
  // The Read aloud part adds its calls here.
}

export interface ReadAloudEvents {
  // The Read aloud part adds its events here.
}
