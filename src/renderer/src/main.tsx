import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
// Literata's static files are not drawn in the window: they are bundled for PDF export, which finds them beside the
// interface (src/main/transfer/pdf.ts, 400 and 700). The window draws the variable font with its optical sizes (the
// display size for headings).
import '@fontsource/literata/400.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/literata/700.css'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import './styles.css'
import { App } from './App'

// Paint the very first frame in the theme the window opened in (settings arrive a moment later).
document.documentElement.dataset.theme = window.aiwrite.initialTheme
// And in the accent colour Adam picked (milestone 6), if any.
if (window.aiwrite.initialAccent) document.documentElement.dataset.accent = window.aiwrite.initialAccent
// And in the New look (Classic is retired).
document.documentElement.dataset.look = window.aiwrite.initialLook ?? 'new'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
