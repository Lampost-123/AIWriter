import { BookOpen, Globe2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorldSummary } from '@shared/types'
import { Button, Card, Field, Input, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

/** Shown when no world is open: create the first world, or open an existing one. */
export function Welcome(): React.JSX.Element {
  const createWorld = useApp((s) => s.createWorld)
  const openWorld = useApp((s) => s.openWorld)
  const [worlds, setWorlds] = useState<WorldSummary[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.listWorlds().then(setWorlds)
  }, [])

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      await createWorld(name)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      setBusy(false)
    }
  }

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
            <Field label="World name">{(id) => <Input id={id} autoFocus value={name} placeholder="The Northern Reaches" onChange={(e) => setName(e.target.value)} />}</Field>
            <Button variant="primary" size="lg" type="submit" loading={busy}>
              Create world
            </Button>
          </form>
        </Card>
        {worlds && worlds.length > 0 ? (
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
