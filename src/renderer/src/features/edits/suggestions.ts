// Tracked changes in the page (milestone 4, Editing with AI): an AI edit shows as the old words struck
// through and the new words highlighted, with Accept and Reject; the scene's text itself changes only on
// Accept. A TipTap extension, in the editor's list (features/editor/extensions.ts). Owned by the AI edits
// part. Groundwork stand-in.
import { Extension } from '@tiptap/core'

export const Suggestions = Extension.create({ name: 'aiwriteSuggestions' })
