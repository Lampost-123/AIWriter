import { BookOpen, FolderX, Globe2, WandSparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, WorldSummary } from '@shared/types'
import { Button, Card, Field, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { createWorldAndBuild } from '@/features/worldBuilder/open'

/** Shown when no world is open: create the first world, or open an existing one. */
export function Welcome(): React.JSX.Element {
  const createWorld = useApp((s) => s.createWorld)
  const openWorld = useApp((s) => s.openWorld)
  const [worlds, setWorlds] = useState<WorldSummary[] | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [name, setName] = useState('')
  // Which way the world is being made: 'build' opens the World builder in it once it is made.
  const [busy, setBusy] = useState<false | 'create' | 'build'>(false)

  const load = useCallback(async (): Promise<{ info: AppInfo; worlds: WorldSummary[] }> => {
    const [i, w] = await Promise.all([api.getAppInfo(), api.listWorlds()])
    setInfo(i)
    setWorlds(w)
    return { info: i, worlds: w }
  }, [])

  useEffect(() => {
    void load().catch((e: Error) => toast(e.message, { tone: 'danger' }))
  }, [load])

  const create = async (build = false): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(build ? 'build' : 'create')
    try {
      await (build ? createWorldAndBuild(name) : createWorld(name))
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setBusy(false)
    }
  }

  // Shown optimistically until the check comes back (it almost always passes).
  const reachable = info?.libraryReachable ?? true

  return (
    <div className="flex h-full items-start justify-center overflow-auto bg-bg px-6 pt-[12vh]">
      <div className="w-full max-w-[460px] animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg">
            <BookOpen size={20} />
          </div>
          <div>
            <h1 className="font-serif text-[24px] font-semibold leading-tight text-fg">AI Write</h1>
            <p className="text-[13px] text-muted">Long stories that stay consistent.</p>
          </div>
        </div>
        {reachable ? (
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-fg">Create a world</h2>
            <p className="mb-4 mt-1 text-[13px] leading-relaxed text-muted">
              A world holds the characters, places and lore shared by every story set in it. You can add books, chapters and scenes once it's made.
            </p>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                void create()
              }}
            >
              <Field label="World name">
                {(id) => <Input id={id} autoFocus value={name} placeholder="For example, The Northern Reaches" onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Button variant="primary" size="lg" type="submit" loading={busy === 'create'} disabled={!name.trim() || !!busy}>
                Create world
              </Button>
              <Button
                size="lg"
                type="button"
                icon={<WandSparkles size={15} />}
                loading={busy === 'build'}
                disabled={!name.trim() || !!busy}
                title="Create the world, then lay it out from a summary you type or paste"
                onClick={() => void create(true)}
              >
                Build from a summary
              </Button>
            </form>
          </Card>
        ) : (
          <MissingLibrary path={info?.libraryPath ?? ''} reload={load} />
        )}
        {reachable && worlds && worlds.length > 0 ? (
          <div className="mt-6">
            <h3 className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Open a world</h3>
            <div className="flex flex-col gap-1">
              {worlds.map((w) => (
                <button
                  key={w.id}
                  onClick={() => void openWorld(w.id).catch((e: Error) => toast(e.message, { tone: 'danger' }))}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-fg hover:bg-surface-2"
                >
                  <Globe2 size={15} className="text-muted" />
                  <span className="flex-1 truncate">{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The library folder is on a drive that isn't connected (or can't be made): say so, and offer a way on. */
function MissingLibrary({
  path,
  reload
}: {
  path: string
  reload: () => Promise<{ info: AppInfo; worlds: WorldSummary[] }>
}): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [choosing, setChoosing] = useState(false)

  const retry = async (): Promise<void> => {
    setChecking(true)
    try {
      const { info, worlds } = await reload()
      if (!info.libraryReachable) {
        toast("AI Write still can't reach that folder.")
        return
      }
      // Back where Adam left off, if his last world is there.
      const last = useApp.getState().settings?.lastWorldId
      if (last && worlds.some((w) => w.id === last)) await useApp.getState().openWorld(last)
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
      await reload()
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
      <p className="mt-1 break-all rounded-md border border-line bg-page px-2.5 py-1.5 text-[13px] text-fg">{path}</p>
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
