// Plain words find and replace uses on screen.

/** "once", "twice", "12 times". */
export const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n.toLocaleString()} times`)

export const BUSY_MESSAGE = 'A draft is being written into this scene. Replace once it’s finished.'
export const BUSY_STORY_MESSAGE = 'A draft is being written into the open scene. Replace once it’s finished.'
export const IN_SUGGESTION_MESSAGE = 'That one is inside the AI’s suggested change. Accept or reject the change first.'
