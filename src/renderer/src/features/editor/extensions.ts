import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { streamPlugin } from './streamDoc'
import { Extension } from '@tiptap/core'
import { requestMarkDone } from './doneShortcut'
import { ParagraphIds } from './paragraphIds'
import { NameUnderlines } from './names/underlines'
import { Suggestions } from '@/features/edits/suggestions'
import { ReadAloudHighlight } from '@/features/readAloud/highlight'
import { SpeakerLabels } from '@/features/readAloud/speakerLabels'
import { LiveChecks } from '@/features/liveChecks/liveDecorations'
import { PageSpelling } from '@/features/spelling/editorSpelling'
import { WordTally } from '@/features/goals/wordTally'

export const EDITOR_PLACEHOLDER = 'Write here, or fill in the scene card and press Generate.'

/**
 * Keeps track of a streaming draft (see streamDoc.ts). Ahead of the undo keys and the history's own
 * handling, so an undo while a draft replaces the scene's text is dealt with first.
 */
const StreamTracking = Extension.create({
  name: 'aiwriteStream',
  priority: 1000,
  addProseMirrorPlugins: () => [streamPlugin]
})

/**
 * Ctrl+Enter (Cmd+Enter on a Mac) marks the scene done, as everywhere else in the writing view.
 * It runs before the line-break shortcut (Shift+Enter still makes a line break).
 */
const MarkDoneShortcut = Extension.create({
  name: 'aiwriteMarkDone',
  priority: 1000,
  addKeyboardShortcuts: () => ({
    'Mod-Enter': () => {
      requestMarkDone()
      return true
    }
  })
})

/**
 * The manuscript editor's extensions: paragraphs, bold, italic, blockquote and a
 * horizontal rule used as a scene break. No headings, lists, links or code:
 * a scene is prose. Every paragraph carries a stable id (paragraphIds.ts), and the names of known
 * entries get a faint underline (names/underlines.ts). Milestone 4 adds tracked changes for AI edits
 * (features/edits/suggestions.ts), the sentence being read aloud (features/readAloud/highlight.ts) and, with
 * "Show speakers and tone", who says each paragraph and how (features/readAloud/speakerLabels.ts);
 * milestone 5 the live checks' underlines (features/liveChecks/liveDecorations.ts). Writing by hand adds spell check
 * and synonyms (features/spelling/editorSpelling.ts) and the daily word count (features/goals/wordTally.ts).
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
    MarkDoneShortcut,
    ParagraphIds,
    NameUnderlines,
    Suggestions,
    ReadAloudHighlight,
    SpeakerLabels,
    LiveChecks,
    PageSpelling,
    WordTally
  ]
}
