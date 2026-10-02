// The soft highlight on the sentence being read, in the page. A TipTap extension, in the editor's list
// (features/editor/extensions.ts). Owned by the Read aloud part. Groundwork stand-in.
import { Extension } from '@tiptap/core'

export const ReadAloudHighlight = Extension.create({ name: 'aiwriteReadAloud' })
