// A check's note in the desk's margin (UI overhaul, phase 3): an open issue the consistency check found in this scene,
// beside the paragraph its words are in, in the issue ink. It quotes the words and says what disagrees with what, with
// **Rewrite** (the AI rewrites the words as a tracked change, as the Issues tab's Fix the text does) and **Keep** (the
// words are meant: the issue is ignored and never raised again, with Undo). The last note shown says how many more
// there are in the Issues tab; the × puts the note away for this session (the issue stays open there).
import type { ID } from '@shared/types'
import { Sparkles, X } from '@/components/ui/icons'
import { fixTheText, ignore } from '@/features/issues/actions'
import { showIssues } from '@/features/issues/issuesStore'
import { KIND_WORDS, SEVERITY_WORDS } from '@/features/issues/issuesLogic'
import type { CheckSlipData } from '../anchors'
import { dismissSlip } from '../marginStore'

export function CheckSlip({ id, data, sceneId }: { id: string; data: CheckSlipData; sceneId: ID }): React.JSX.Element {
  const { issue, more } = data
  const quote = issue.quote.trim()
  return (
    <div className="desk-paper k-issue desk-check" data-severity={issue.severity} data-issue={issue.id}>
      <span className="s-head">
        <span className="desk-caps s-kind">
          Check · {issue.severity === 'must-fix' ? SEVERITY_WORDS['must-fix'] : (KIND_WORDS[issue.kind] ?? 'Issue')}
        </span>
      </span>
      <span className="s-text">
        {quote ? <span className="s-quote">“{quote.length > 80 ? `${quote.slice(0, 78).trimEnd()}…` : quote}”</span> : null}
        {quote ? ' — ' : null}
        {issue.message}
      </span>
      <span className="s-acts">
        <button type="button" className="desk-ai-sm press" onClick={() => fixTheText(issue)}>
          <Sparkles size={13} aria-hidden />
          <span>Rewrite</span>
        </button>
        <button type="button" className="desk-sec-sm press" onClick={() => void ignore(issue)}>
          Keep
        </button>
        {more > 0 ? (
          <button type="button" className="s-more" onClick={() => void showIssues(sceneId)}>
            {more} more in Issues
          </button>
        ) : null}
      </span>
      <button type="button" className="desk-slip-x" aria-label="Put this check’s note away" title="Put this note away" onClick={() => dismissSlip(sceneId, id)}>
        <X size={12} />
      </button>
    </div>
  )
}
