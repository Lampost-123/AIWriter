// Writing by hand: keeps spell check in step with what Adam is doing, and answers the right-click menu.
//  - The main process is asked to sync spell check (on or off, UK or US, the words that count as correct) whenever
//    the world, the story, a style guide, the world's entries or the switch in Settings › Editor change; the page
//    marks those words so they show no underline (knownWords.ts).
//  - "Add to this world's glossary" makes a glossary entry named after the word, with Undo in a message.
//  - A synonym picked in the menu is put into the page (editorSpelling.ts).
import { toast } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { replaceNoted } from './editorSpelling'
import { setKnownWords } from './knownWords'

/** What spell check depends on in the window: a change to any of these syncs it. */
function syncKey(): string {
  const s = useApp.getState()
  const story = s.stories.find((x) => x.id === s.storyId)
  return JSON.stringify([
    s.world?.id ?? null,
    s.world?.style?.spelling ?? '',
    s.storyId,
    story?.style?.spelling ?? '',
    s.settings?.editor?.spellCheck !== false,
    s.entriesRev,
    s.memoryRev
  ])
}

/** Makes a glossary entry for a word, with Undo. */
async function addToGlossary(word: string): Promise<void> {
  const app = useApp.getState()
  if (!app.world) return
  try {
    const e = await api.createEntry('glossary', { name: word, originStoryId: app.storyId })
    useApp.getState().bumpEntries()
    toast(`“${word}” is in this world’s glossary now.`, {
      action: {
        label: 'Undo',
        run: () =>
          void api
            .deleteEntry(e.id)
            .then(() => useApp.getState().bumpEntries())
            .catch((err: Error) => toast(`It couldn’t be taken out again. ${err.message}`, { tone: 'danger' }))
      }
    })
  } catch (err) {
    toast(`“${word}” couldn’t be added to the glossary. ${(err as Error).message}`, { tone: 'danger' })
  }
}

/** Starts it all (once, from App). Returns a function that stops it. */
export function installSpelling(): () => void {
  let last = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  const sync = (): void => {
    if (!useApp.getState().ready) return
    const key = syncKey()
    if (key === last) return
    last = key
    if (timer) clearTimeout(timer)
    // A moment's wait gathers a burst of changes (a world opening, a builder making entries) into one.
    timer = setTimeout(() => {
      timer = null
      void api
        .syncSpelling(useApp.getState().storyId)
        .then((s) => setKnownWords(s.knownWords))
        .catch(() => undefined)
    }, 250)
  }
  sync()
  const offApp = useApp.subscribe(sync)
  const offReplace = onEvent('spelling:replaceWord', ({ token, replacement }) => replaceNoted(token, replacement))
  const offGlossary = onEvent('spelling:addToGlossary', ({ word }) => void addToGlossary(word))
  const offWords = onEvent('spelling:wordsChanged', ({ knownWords }) => setKnownWords(knownWords))
  // A right-click anywhere but the page: the menu needn't wait to hear which word it is on (the page says itself).
  const onContextMenu = (e: MouseEvent): void => {
    const target = e.target as Element | null
    if (!target?.closest?.('.ProseMirror.scene-prose')) void api.noteContextWord(null).catch(() => undefined)
  }
  window.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    offApp()
    offReplace()
    offGlossary()
    offWords()
    window.removeEventListener('contextmenu', onContextMenu, true)
    if (timer) clearTimeout(timer)
  }
}
