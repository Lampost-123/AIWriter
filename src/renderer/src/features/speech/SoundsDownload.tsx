// PLACEHOLDER (sound effects UI branch): the Speech engine part writes the real card (the sound effects download, with
// its progress, Cancel and Try again). Take that version when merging; this one only lets the Sound effects settings
// build and show something in its place.
import { Notice } from '@/components/ui'

export function SoundsDownload(): React.JSX.Element {
  return <Notice>Sound effects need a download of their own. It is set up in the speech engine’s section above.</Notice>
}
