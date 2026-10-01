import { useState } from 'react'
import { Button, Dialog, Field, Input, toast } from '@/components/ui'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'

export function NewWorldDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): React.JSX.Element {
  const createWorld = useApp((s) => s.createWorld)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await flushAll()
      await createWorld(name)
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
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
        <Field label="World name">{(id) => <Input id={id} autoFocus value={name} placeholder="The Northern Reaches" onChange={(e) => setName(e.target.value)} />}</Field>
      </form>
    </Dialog>
  )
}
