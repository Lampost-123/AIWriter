// What the Drafts tab does with a scene's drafts. The current draft is the scene's own text (the page);
// the others are kept in the world's history. Every change can be taken back: a new draft and a delete
// from their message's Undo, and a switch with Ctrl+Z in the page (or the message's Switch back).
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ID } from '@shared/types'
import type { DraftInfo, PageNow, SceneDrafts } from '@shared/contracts/history'
import { toast } from '@/components/ui'
import { api, modKey } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { plainReason } from '@/lib/reason'
import { announceDelete } from '@/lib/undoDelete'

/** The page as it shows now, or null (with a message) when it can't be changed right now. */
function pageNow(sceneId: ID, doing: string): PageNow | null {
  const bridge = editorBridge()
  const page = bridge?.current()
  if (!bridge || !page || page.sceneId !== sceneId) {
    toast(`Open this scene to ${doing}.`)
    return null
  }
  if (bridge.busy()) {
    toast(`A draft is being written into this scene. You can ${doing} once it has finished, or press Stop.`)
    return null
  }
  return page
}

/** Starts a new draft as a copy of the current one, which is kept as it is. Returns the scene's drafts, or null. */
export async function startNewDraft(sceneId: ID, onChange: (d: SceneDrafts) => void): Promise<SceneDrafts | null> {
  const page = pageNow(sceneId, 'start a new draft')
  if (!page) return null
  try {
    const { drafts, created, kept } = await api.newDraft(page)
    toast(`${created.name} is a copy of ${kept.name} to work on. ${kept.name} is kept as it was.`, {
      action: {
        label: 'Undo',
        run: () => {
          api
            .undoNewDraft(sceneId, created.id, kept.id)
            .then(onChange)
            .catch((e: unknown) => toast(`The new draft couldn't be taken back. ${plainReason(e)}`, { tone: 'danger' }))
        }
      }
    })
    return drafts
  } catch (e) {
    toast(`A new draft couldn't be started. ${plainReason(e)}`, { tone: 'danger' })
    return null
  }
}

/**
 * Makes another draft the current one: the page as it is is kept as the draft it was, and the chosen
 * draft goes in its place as one step Ctrl+Z takes back. Returns the scene's drafts, or null.
 */
export async function switchToDraft(sceneId: ID, to: DraftInfo, onChange: (d: SceneDrafts) => void): Promise<SceneDrafts | null> {
  const page = pageNow(sceneId, 'switch drafts')
  const bridge = editorBridge()
  if (!page || !bridge) return null
  const editor = bridge.editor
  const before = editor?.state.doc ?? null
  let res: Awaited<ReturnType<typeof api.switchDraft>>
  try {
    res = await api.switchDraft(page, to.id)
  } catch (e) {
    toast(`The drafts couldn't be switched. ${plainReason(e)}`, { tone: 'danger' })
    return null
  }
  if (!bridge.replaceScene(sceneId, res.to.doc, res.to.text)) {
    // The page couldn't take it after all: the draft that was current stays current, with the page as it is.
    const back = await api.setCurrentDraft(sceneId, res.from.id).catch(() => null)
    if (back) onChange(back)
    toast("The page wasn't ready, so the drafts weren't switched. Try again in a moment.", { tone: 'danger' })
    return null
  }
  const after = editor?.state.doc ?? null
  if (editor && before && after) watchSwitch({ sceneId, editor, before, after, fromId: res.from.id, toId: res.to.id, onChange })
  // The keyboard goes into the page, where Ctrl+Z switches back.
  if (editor && !editor.isDestroyed) editor.view.focus()
  toast(`Switched to ${res.to.name}. ${res.from.name} is kept as it was; ${modKey()}+Z switches back.`, {
    action: {
      label: 'Switch back',
      run: () => {
        // Already switched back (with Ctrl+Z, say): nothing to do.
        const doc = editorBridge()?.sceneId === sceneId ? editorBridge()?.editor?.state.doc : null
        if (doc && before && sameDoc(doc, before)) return
        void switchToDraft(sceneId, res.from, onChange).then((d) => d && onChange(d))
      }
    }
  })
  return res.drafts
}

/** Renames a draft (an empty name gives it its number back). Returns it renamed, or null. */
export async function renameDraft(draft: DraftInfo, name: string): Promise<DraftInfo | null> {
  try {
    return await api.renameDraft(draft.id, name)
  } catch (e) {
    toast(`The draft couldn't be renamed. ${plainReason(e)}`, { tone: 'danger' })
    return null
  }
}

/** Deletes a draft that isn't current; its message's Undo brings it back. Returns true when it went. */
export async function deleteDraft(draft: DraftInfo, reload: () => void): Promise<boolean> {
  try {
    await api.deleteDraft(draft.id)
  } catch (e) {
    toast(`The draft couldn't be deleted. ${plainReason(e)}`, { tone: 'danger' })
    return false
  }
  announceDelete({
    message: `“${draft.name}” deleted.`,
    noun: ['draft', 'drafts'],
    undo: async () => {
      await api.restoreDraft(draft.id)
      reload()
    }
  })
  return true
}

// ---------- Ctrl+Z after a switch ----------

interface Watch {
  sceneId: ID
  editor: Editor
  /** The page just before the switch (the draft switched away from), and just after it. */
  before: PMNode
  after: PMNode
  fromId: ID
  toId: ID
  onChange: (d: SceneDrafts) => void
}

/** The switches Ctrl+Z can still take back, oldest first (each stops itself once its scene leaves the page). */
const watching: (() => void)[] = []
/** More switches back than anyone undoes in one go. */
const MAX_WATCHED = 20

const sameDoc = (a: PMNode, b: PMNode): boolean => a.content.size === b.content.size && a.eq(b)

/**
 * After a switch, Ctrl+Z in the page brings the draft switched away from back into it (and Ctrl+Y the
 * other again). Each time the page shows one of them exactly, that draft is marked current, so the
 * drafts always say which one is in the page. Stops once the page shows another scene.
 */
function watchSwitch(w: Watch): void {
  let showing: 'to' | 'from' = 'to'
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
    if (!transaction.docChanged) return
    const bridge = editorBridge()
    if (!bridge || bridge.sceneId !== w.sceneId || bridge.editor !== w.editor) {
      stop()
      return
    }
    const doc = w.editor.state.doc
    const now = showing === 'to' && sameDoc(doc, w.before) ? 'from' : showing === 'from' && sameDoc(doc, w.after) ? 'to' : null
    if (!now) return
    showing = now
    api
      .setCurrentDraft(w.sceneId, now === 'from' ? w.fromId : w.toId)
      .then(w.onChange)
      .catch((e: unknown) => console.warn('Could not mark the draft in the page as current', e))
  }
  const stop = (): void => {
    w.editor.off('transaction', onTransaction)
    const i = watching.indexOf(stop)
    if (i >= 0) watching.splice(i, 1)
  }
  w.editor.on('transaction', onTransaction)
  watching.push(stop)
  if (watching.length > MAX_WATCHED) watching[0]()
}
