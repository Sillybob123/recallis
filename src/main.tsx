import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyClozeColors, loadAnkiSettings } from './lib/settings'

// Cloze highlight colors are CSS variables; paint them before the first render
// so cards never flash the defaults. Login sync re-applies whatever is remote.
applyClozeColors(loadAnkiSettings())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
