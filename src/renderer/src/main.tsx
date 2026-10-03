import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/literata/400.css'
import '@fontsource/literata/400-italic.css'
import '@fontsource/literata/600.css'
import '@fontsource/literata/700.css'
import './styles.css'
import { App } from './App'

// Paint the very first frame in the theme the window opened in (settings arrive a moment later).
document.documentElement.dataset.theme = window.aiwrite.initialTheme
// And in the accent colour Adam picked (milestone 6), if any.
if (window.aiwrite.initialAccent) document.documentElement.dataset.accent = window.aiwrite.initialAccent

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
