// Other ways to start, offered on the Welcome screen and the first run's world step (milestone 6). Two other parts
// provide them: "Import a manuscript…" (the manuscript import part) and "Import a world file…" (the world files
// part). Until one is listed here, nothing shows. To wire one in, add a line to WELCOME_ACTIONS, for example:
//
//   { id: 'import-manuscript', label: 'Import a manuscript…', icon: FileText, hint: 'Word, Markdown or plain text', run: importManuscriptFromWelcome },
//   { id: 'import-world', label: 'Import a world file…', icon: FileArchive, hint: 'An .aiwrite file', run: importWorldFile },
//
// `run` is called with nothing open in front of it (the Welcome screen, or the setup's first step); any error it
// throws is shown in a toast.

import { CookingPot, FileArchive, FileText, type IconType } from '@/components/ui/icons'
import { useState } from 'react'
import { Button, toast, type ButtonProps } from '@/components/ui'
import { cn } from '@/lib/cn'
import { importManuscriptFromWelcome } from '@/features/importing/importStore'
import { importWorld } from '@/features/transfer/worldFiles'
import { openRecipes } from '@/features/recipes/recipeStore'

export interface WelcomeAction {
  id: 'import-manuscript' | 'import-world' | (string & {})
  /** The button's words: "Import a manuscript…". */
  label: string
  icon: IconType
  /** A few words under it, or in its tooltip. */
  hint?: string
  run: () => void | Promise<void>
}

/** The other ways to start. */
export const WELCOME_ACTIONS: WelcomeAction[] = [
  { id: 'import-manuscript', label: 'Import a manuscript…', icon: FileText, hint: 'A book in Word, Markdown or plain text', run: importManuscriptFromWelcome },
  { id: 'import-world', label: 'Import a world file…', icon: FileArchive, hint: 'An .aiwrite file from AI Write, on this computer or another', run: importWorld },
  { id: 'recipes', label: 'Story recipes', icon: CookingPot, hint: 'Borrow the shape and style of a story you admire', run: openRecipes }
]

/** The welcome actions as a row of buttons; nothing at all while there are none. */
export function WelcomeActionButtons({
  actions = WELCOME_ACTIONS,
  className,
  size,
  variant,
  icons = true
}: {
  actions?: WelcomeAction[]
  className?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  /** False for a quiet row of plain links (the setup's "Not sure yet?" card). */
  icons?: boolean
}): React.JSX.Element | null {
  const [busy, setBusy] = useState<string | null>(null)
  if (!actions.length) return null
  const run = async (a: WelcomeAction): Promise<void> => {
    setBusy(a.id)
    try {
      await a.run()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {actions.map((a) => {
        const Icon = a.icon
        return (
          <Button key={a.id} size={size} variant={variant} icon={icons ? <Icon size={15} /> : undefined} title={a.hint} loading={busy === a.id} disabled={!!busy} onClick={() => void run(a)}>
            {a.label}
          </Button>
        )
      })}
    </div>
  )
}
