// What the AI tools are called on screen: in the menu over selected words, beside a change in the page, in
// History's snapshot labels ("Before Condense") and in What the AI saw. Owned by the AI edits part.
import type { EditTool } from '@shared/types'

/** Each tool's name, as the menu and History show it. */
export const TOOL_NAMES: Record<EditTool, string> = {
  rewrite: 'Rewrite',
  expand: 'Expand',
  condense: 'Condense',
  vivid: 'More vivid',
  tone: 'Change tone',
  voice: 'Fix voice',
  alternatives: 'Alternatives',
  continue: 'Continue'
}

/** What shows while each tool writes. */
export const TOOL_WORKING: Record<EditTool, string> = {
  rewrite: 'Rewriting',
  expand: 'Expanding',
  condense: 'Condensing',
  vivid: 'Making it more vivid',
  tone: 'Changing the tone',
  voice: 'Fixing the voices',
  alternatives: 'Writing three versions',
  continue: 'Writing on'
}
