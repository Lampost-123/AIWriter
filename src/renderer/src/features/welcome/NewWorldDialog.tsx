import { WandSparkles } from 'lucide-react'
import { useState } from 'react'
import { Button, Dialog, Field, Input, toast } from '@/components/ui'
import { flushBeforeWorldChange } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { createWorldAndBuild } from '@/features/worldBuilder/open'

export function NewWorldDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): React.JSX.Element {
  const createWorld = useApp((s) => s.createWorld)
  const [name, setName] = useState('')
  // Which way the world is being made: 'build' opens the World builder in it once it is made.
  const [busy, setBusy] = useState<false | 'create' | 'build'>(false)

  const submit = async (build = false): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(build ? 'build' : 'create')
    try {
      await flushBeforeWorldChange()
      await (build ? createWorldAndBuild(name) : createWorld(name))
      setName('')
      onOpenChange(false)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New world"
      description="A world holds the characters, places and lore shared by every story set in it. Unrelated stories belong in separate worlds."
      footer={
        <>
          <Button
            icon={<WandSparkles size={15} />}
            className="mr-auto"
            loading={busy === 'build'}
            disabled={!name.trim() || !!busy}
            title="Create the world, then lay it out from a summary you type or paste"
            onClick={() => void submit(true)}
          >
            Build from a summary
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy === 'create'} disabled={!name.trim() || !!busy} onClick={() => void submit()}>
            Create world
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="World name">{(id) => <Input id={id} autoFocus value={name} placeholder="For example, The Northern Reaches" onChange={(e) => setName(e.target.value)} />}</Field>
      </form>
    </Dialog>
  )
}
