// Test-only stand-in for the manuscript editor, used by harness.config.mjs so
// the drafting controls can be checked in the real app before the editor is
// merged. It shows a scene header with GenerateControls and a plain page that
// registers a minimal EditorBridge (the same contract the real editor uses).
// Styles are inline: Tailwind only generates classes it finds under src/.
import { useEffect, useRef, useState } from 'react'
import { setEditorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { api } from '@/lib/api'
import { GenerateControls } from '@/features/generate/GenerateControls'

export function SceneView() {
  const sceneId = useApp((s) => s.sceneId)
  const pageRef = useRef(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (!sceneId) return
    let text = ''
    let streamId = null
    const show = () => {
      if (pageRef.current) pageRef.current.textContent = text
    }
    api.getScene(sceneId).then((s) => {
      setTitle(s.title)
      text = s.text
      show()
    })
    setEditorBridge({
      sceneId,
      beginStream: (sid, gid) => {
        if (sid !== sceneId) return false
        streamId = gid
        if (text.trim()) text += '\n\n'
        window.__streamEvents = (window.__streamEvents || []).concat([{ type: 'begin', gid }])
        return true
      },
      appendStream: (gid, t) => {
        if (gid !== streamId) return
        text += t
        window.__streamEvents = (window.__streamEvents || []).concat([{ type: 'append', gid, t }])
        show()
      },
      endStream: (gid) => {
        if (gid !== streamId) return
        streamId = null
        window.__streamEvents = (window.__streamEvents || []).concat([{ type: 'end', gid }])
        void api.saveSceneText(sceneId, null, text)
      },
      flush: async () => {},
      getText: () => text
    })
    return () => setEditorBridge(null)
  }, [sceneId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          display: 'flex',
          height: 48,
          flexShrink: 0,
          alignItems: 'center',
          gap: 12,
          paddingLeft: 20,
          paddingRight: 12,
          borderBottom: '1px solid var(--line)',
          background: 'var(--page)'
        }}
      >
        <div style={{ minWidth: 0, flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {sceneId ? <GenerateControls sceneId={sceneId} /> : null}
      </header>
      <div style={{ minHeight: 0, flex: 1, overflow: 'auto', background: 'var(--page)' }}>
        <div
          ref={pageRef}
          data-testid="page"
          style={{
            margin: '0 auto',
            maxWidth: '70ch',
            whiteSpace: 'pre-wrap',
            padding: '40px 32px',
            fontFamily: 'var(--font-serif)',
            fontSize: 17,
            lineHeight: 1.7,
            color: 'var(--fg)',
            userSelect: 'text'
          }}
        />
      </div>
    </div>
  )
}
