// A microphone button by a text box (Ask the world, the Quick start box): one click starts listening, the
// next stops and gives back what was said. Shows only when dictation can be used. Owned by the Dictation
// part. Groundwork stand-in.

export interface MicButtonProps {
  /** What was said, tidied ("um" and stutters taken out), to put in the box at its cursor. */
  onText: (text: string) => void
  disabled?: boolean
  className?: string
}

export function MicButton(_props: MicButtonProps): React.JSX.Element | null {
  return null
}
