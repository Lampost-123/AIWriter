import './phone.css'
import { installPhoneBridge } from './bridge'

const root = document.getElementById('root')
void installPhoneBridge()
  .then(() => import('../main'))
  .catch((err: unknown) => {
    if (root) root.textContent = err instanceof Error ? err.message : 'AI Write could not open on this phone.'
  })
