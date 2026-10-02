// What the Issues tab's buttons do (milestone 5, AI checks): fix the text (the check's suggested rewrite as
// a tracked change, or the AI tools' Rewrite on the sentence), update the memory, ignore and reopen (each
// undoable), check the scene, and follow an issue's links. Nothing asks "are you sure?".
import { ALL_CHECKS } from '@shared/contracts/checks'
import type { Issue, IssueSource } from '@shared/contracts/checks'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Entry, EntryInput, ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, type ApiError } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { plainReason } from '@/lib/reason'
import { useApp } from '@/lib/store'
import { findTextRange } from '@/features/editor/findText'
import { requestReveal } from '@/features/editor/reveal'
import { showReplacement, startTool } from '@/features/edits/session'
import { wordsIn } from '@/features/edits/text'
import { openScene } from '@/features/memory/openScene'
import { openStorySettings } from '@/features/stories/storyActions'
import { fieldWords, fixDirection, occurrencesIn, pickOccurrence, sentenceAround } from './issuesLogic'
import { loadIssues, patchIssue, useIssuesStore } from './issuesStore'

const WORDS_GONE = 'Those words aren’t in the scene any more.'

/** Shows the issue's words in the page (selected and scrolled into view). */
export function showWords(issue: Issue): void {
  if (issue.sceneId && issue.quote) requestReveal(issue.sceneId, issue.quote)
}

/** Follows one of an issue's links: an entry opens beside the page, a scene opens, a story its settings. */
export function openSource(s: IssueSource): void {
  if (s.kind === 'entry' || s.kind === 'thread') useApp.getState().peekEntry(s.entryId)
  else if (s.kind === 'scene') void openScene(s.sceneId)
  else openStorySettings(s.storyId)
}

/** Marked fixed once its tracked change is accepted. */
const markFixed = (issue: Issue) => (): void => {
  if (issue.sceneId) patchIssue(issue.sceneId, issue.id, { status: 'fixed' })
  void api.markIssueFixed(issue.id).catch(() => undefined)
}

/** Every place the quote appears in the page, each inside one paragraph, in reading order. */
function placesInPage(doc: PMNode, quote: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // One character per position: a line break inside the paragraph reads as a space.
    const text = node.textBetween(0, node.content.size, undefined, ' ')
    for (const r of occurrencesIn(text, quote)) out.push({ from: pos + 1 + r.from, to: pos + 1 + r.to })
    return false
  })
  return out
}

/**
 * Fix the text: the check's suggested rewrite shows in the page as a tracked change (no AI call) when its
 * words are found whole, in one place it can be sure of; otherwise the AI tools' Rewrite works on the
 * sentence the words are in, told what the problem is. Accepting the change marks the issue fixed;
 * rejecting it leaves the issue as it was.
 */
export function fixTheText(issue: Issue): void {
  const bridge = editorBridge()
  const editor = bridge?.editor
  if (!issue.sceneId || !editor || bridge?.sceneId !== issue.sceneId) {
    toast('Open the scene to fix its text.')
    return
  }
  const doc = editor.state.doc
  const places = issue.quote.trim() ? placesInPage(doc, issue.quote) : []
  const exact = pickOccurrence(places, issue.occurrence)
  // Not whole in one paragraph (it runs across two): where its first part is.
  const range = exact ?? places[0] ?? (issue.quote.trim() ? findTextRange(doc, issue.quote) : null)
  if (!range) {
    toast(WORDS_GONE)
    void loadIssues(issue.sceneId)
    return
  }
  if (issue.fix && exact) {
    showReplacement({ ...exact, text: issue.fix, note: 'The consistency check’s suggested rewrite.', onAccepted: markFixed(issue) })
    return
  }
  // The whole sentence the words are in, within their paragraph.
  const $from = doc.resolve(range.from)
  const start = $from.start()
  const para = $from.parent
  const text = para.textBetween(0, para.content.size, undefined, ' ')
  const s = sentenceAround(text, range.from - start, Math.min(range.to, $from.end()) - start)
  const target = wordsIn(doc, start + s.from, start + s.to) ?? range
  void startTool('rewrite', { direction: fixDirection(issue), range: target, onAccepted: markFixed(issue) })
}

/** A field's value on an entry. */
const valueOf = (e: Entry, field: string): string =>
  field === 'summary' ? e.summary : field === 'description' ? e.description : (e.fields?.[field] ?? '')

const patchFor = (field: string, value: string): EntryInput =>
  field === 'summary' || field === 'description' ? { [field]: value } : { fields: { [field]: value } }

/** Update the memory: the field takes the text's value, as Adam's, and the issue is fixed. Undo puts both back. */
export async function updateTheMemory(issue: Issue): Promise<void> {
  const fix = issue.memoryFix
  if (!fix) return
  let before: string | null = null
  let name = ''
  try {
    const e = await api.getEntry(fix.entryId)
    before = valueOf(e, fix.field)
    name = e.name
  } catch {
    /* said by the update below */
  }
  try {
    await api.updateMemoryFromIssue(issue.id)
  } catch (e) {
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  if (issue.sceneId) patchIssue(issue.sceneId, issue.id, { status: 'fixed' })
  const app = useApp.getState()
  app.bumpEntries()
  toast(name ? `Updated ${name}’s ${fieldWords(fix.field)} in the memory to “${fix.value}”.` : `Updated the memory to “${fix.value}”.`, {
    tone: 'success',
    action:
      before === null
        ? undefined
        : {
            label: 'Undo',
            run: () =>
              void (async () => {
                try {
                  await api.updateEntry(fix.entryId, patchFor(fix.field, before ?? ''))
                  await api.reopenIssue(issue.id)
                  useApp.getState().bumpEntries()
                  useApp.getState().bumpMemory()
                } catch (e) {
                  toast(`That couldn’t be undone. ${plainReason(e)}`, { tone: 'danger' })
                }
              })()
          }
  })
}

/** Ignore: hidden at once and never raised again. Undo reopens it. */
export async function ignore(issue: Issue): Promise<void> {
  if (issue.sceneId) patchIssue(issue.sceneId, issue.id, { status: 'ignored' })
  try {
    await api.ignoreIssue(issue.id)
  } catch (e) {
    if (issue.sceneId) patchIssue(issue.sceneId, issue.id, { status: issue.status })
    toast(plainReason(e), { tone: 'danger' })
    return
  }
  toast('Ignored. It won’t be raised again.', { action: { label: 'Undo', run: () => void reopen({ ...issue, status: 'ignored' }) } })
}

/** Reopen an ignored (or fixed) issue. */
export async function reopen(issue: Issue): Promise<void> {
  if (issue.sceneId) patchIssue(issue.sceneId, issue.id, { status: 'open' })
  try {
    const now = await api.reopenIssue(issue.id)
    // A live flag Adam ignored isn't kept as an open issue: it goes, and shows in the page again.
    if (issue.sceneId && now.status !== 'open') patchIssue(issue.sceneId, issue.id, { status: now.status })
  } catch (e) {
    if (issue.sceneId) patchIssue(issue.sceneId, issue.id, { status: issue.status })
    toast(plainReason(e), { tone: 'danger' })
  }
}

/** Check this scene: every check, after the page's last words are saved. A problem is shown in the tab. */
export async function checkThisScene(sceneId: ID): Promise<void> {
  const fail = (message: string): void => useIssuesStore.setState({ failed: { ...useIssuesStore.getState().failed, [sceneId]: message } })
  const clear = (): void => {
    const failed = { ...useIssuesStore.getState().failed }
    delete failed[sceneId]
    useIssuesStore.setState({ failed })
  }
  clear()
  try {
    await flushAll()
    await api.startCheck({ runId: globalThis.crypto.randomUUID(), target: { scope: 'scene', id: sceneId }, checks: [...ALL_CHECKS] })
  } catch (e) {
    fail((e as ApiError).message || plainReason(e))
  }
}

export async function stopRun(runId: ID): Promise<void> {
  try {
    await api.stopCheck(runId)
  } catch (e) {
    toast(plainReason(e))
  }
}
