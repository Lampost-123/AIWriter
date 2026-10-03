import { FolderX } from '@/components/ui/icons'
import { useState } from 'react'
import { Button, Card, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { loadLibrary } from './libraryStore'

/** The library folder is on a drive that isn't connected (or can't be made): say so, and offer a way on. */
export function MissingLibrary({ path }: { path: string }): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [choosing, setChoosing] = useState(false)

  const retry = async (): Promise<void> => {
    setChecking(true)
    try {
      const library = await loadLibrary()
      if (!library?.reachable) {
        toast("AI Write still can't reach that folder.")
        return
      }
      // Back where Adam left off, if his last world is there.
      const last = useApp.getState().settings?.lastWorldId
      if (last && library.worlds.some((w) => w.id === last)) await useApp.getState().openWorld(last)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setChecking(false)
    }
  }

  const choose = async (): Promise<void> => {
    setChoosing(true)
    try {
      const chosen = await api.chooseLibraryFolder()
      if (!chosen) return
      await useApp.getState().init()
      await loadLibrary()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setChoosing(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <FolderX size={16} className="shrink-0 text-muted" />
        <h2 className="text-[15px] font-semibold text-fg">AI Write can't find your library folder</h2>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">Your worlds are kept in this folder:</p>
      <p className="mt-1 break-all rounded-md border border-line bg-page px-2.5 py-1.5 text-[13px] text-fg select-text">{path}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        If it's on a drive that isn't plugged in, plug it in and choose Try again. Or choose another folder.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" loading={checking} onClick={() => void retry()}>
          Try again
        </Button>
        <Button loading={choosing} onClick={() => void choose()}>
          Choose another folder…
        </Button>
      </div>
    </Card>
  )
}
