// Fix the text's rewrite, once accepted (the AI tools' Rewrite on an issue's sentence when the check had no ready-made
// fix: features/issues/actions.ts). Its new words are checked as a draft's are when it lands (check and repair,
// repairRun.ts): a rewrite that breaks continuity is caught, mended or asked about like any other. The issue is marked
// fixed only when that check ran and found nothing to ask. Otherwise (something asked, or nothing checked: the switch
// off, no memory model, a failed call) it isn't counted as fixed: its words have left the scene, so the Issues tab puts
// it away as gone, and a fix no check has seen is never taught to later scenes as a slip put right (checks/lessons.ts).
import type { Issue } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import { flushAll } from '@/lib/flush'
import { loadIssues, patchIssue } from '@/features/issues/issuesStore'
import { checkLanded } from './repairRun'

/** What Fix the text's rewrite does once accepted: check the new words, then mark the issue fixed (`markFixed`) if they pass. */
export function fixedOnceChecked(issue: Pick<Issue, 'id' | 'sceneId'>, markFixed: () => void) {
  return (words: { from: number; to: number }, recordId: ID | null): void => {
    const sceneId = issue.sceneId
    if (!sceneId) return
    // Out of the list at once, as a fix is: its words have just left the scene.
    patchIssue(sceneId, issue.id, { status: 'gone' })
    void (async () => {
      const check = recordId ? await checkLanded({ sceneId, recordId, ...words }) : null
      if (check?.checked && check.asked === 0) {
        markFixed()
        return
      }
      // As the main process has it now (the new words saved first, so words that have gone are put away as gone).
      await flushAll().catch(() => undefined)
      await loadIssues(sceneId)
    })()
  }
}
