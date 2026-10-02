import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { streamPlugin } from './streamDoc'
import { Extension } from '@tiptap/core'
import { requestAccept } from './acceptRequest'

export const EDITOR_PLACEHOLDER = 'Write here, or fill in the scene card and press Generate.'

/** Keeps track of a streaming draft (see streamDoc.ts). */
const StreamTracking = Extension.create({
  name: 'aiwriteStream',
  addProseMirrorPlugins: () => [streamPlugin]
})

/**
 * Ctrl+Enter (Cmd+Enter on a Mac) accepts the scene, as everywhere else in the writing view.
 * It runs before the line-break shortcut (Shift+Enter still makes a line break).
 */
const AcceptShortcut = Extension.create({
  name: 'aiwriteAccept',
  priority: 1000,
  addKeyboardShortcuts: () => ({
    'Mod-Enter': () => {
      requestAccept()
      return true
    }
  })
})

/**
 * The manuscript editor's extensions: paragraphs, bold, italic, blockquote and a
 * horizontal rule used as a scene break. No headings, lists, links or code:
 * a scene is prose.
 */
export function sceneExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: false,
      code: false,
      codeBlock: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      link: false,
      strike: false,
      underline: false,
      dropcursor: { color: 'var(--accent)', width: 2 }
    }),
    Placeholder.configure({ placeholder: EDITOR_PLACEHOLDER }),
    StreamTracking,
    AcceptShortcut
  ]
}
