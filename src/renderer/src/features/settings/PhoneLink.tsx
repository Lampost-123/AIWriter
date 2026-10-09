// Settings › About and updates › On your phone. The phone is another window on this computer.
import { useEffect, useState } from 'react'
import { showPhoneCode, type PhoneLink } from '@shared/contracts/phone'
import { Button, SettingsSection } from '@/components/ui'
import { api } from '@/lib/api'

const STARTING = 'The phone link is starting.'

export function PhoneLinkSettings(): React.JSX.Element {
  const [link, setLink] = useState<PhoneLink | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void api
      .getPhoneLink()
      .then(setLink)
      .catch(() => undefined)
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (link?.problem !== STARTING) return
    const timer = setTimeout(refresh, 400)
    return () => clearTimeout(timer)
  }, [link])

  const run = (work: () => Promise<PhoneLink>): void => {
    setBusy(true)
    void work()
      .then(setLink)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }

  const problem = link?.problem && link.problem !== STARTING ? link.problem : ''

  return (
    <SettingsSection
      title="On your phone"
      description="Use AI Write on your phone, on the same Wi-Fi. The phone is another window. Your worlds, the AI and the voices stay on this computer. Talking still uses this computer’s microphone. Change a scene on one screen at a time; the last save is the one kept."
    >
      {link?.on ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[13px] text-muted">On the phone, open</p>
            {link.addresses.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {link.addresses.map((address) => (
                  <li key={address} className="select-all font-mono text-[14px] text-fg">
                    {address}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-muted">{link.problem === STARTING ? 'Starting…' : ''}</p>
            )}
          </div>
          <div>
            <p className="text-[13px] text-muted">Then type this code</p>
            <p className="mt-1 font-mono text-[28px] tracking-[0.25em] text-fg">{showPhoneCode(link.code)}</p>
          </div>
          {problem ? <p className="text-[13px] text-danger">{problem}</p> : null}
          <p className="text-[13px] text-muted">
            If the phone cannot open the page, allow AI Write on private networks when Windows asks.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => api.newPhoneCode())}>
              New code
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => api.setPhoneLink(false))}>
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {problem ? <p className="text-[13px] text-danger">{problem}</p> : null}
          <div>
            <Button variant="primary" size="sm" disabled={busy || !link} loading={busy} onClick={() => run(() => api.setPhoneLink(true))}>
              Allow your phone
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
