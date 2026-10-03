// The top bar's Ask the world button: opens the chat beside the page (from any page), or closes it.
// Owned by the Ask the world part.
import { MessagesSquare } from '@/components/ui/icons'
import { IconButton } from '@/components/ui'
import { useApp } from '@/lib/store'
import { closeAsk, openAsk } from './open'

export function AskButton(): React.JSX.Element {
  // Showing: open, on the writing page, with the panel beside the page not hidden.
  const showing = useApp((s) => s.askOpen && s.view.kind === 'write' && !!s.settings?.layout.inspectorOpen)
  return (
    <IconButton label="Ask the world" active={showing} aria-pressed={showing} onClick={() => (showing ? closeAsk() : openAsk())}>
      <MessagesSquare size={16} />
    </IconButton>
  )
}
