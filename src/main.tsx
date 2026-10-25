import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { initializeLanguage } from './utils/i18n'
// Dev builds only: simulated USB keyboards (Settings -> MIDI Keyboard), installed
// before the app first asks for MIDI access
import './utils/midiSimulator'

// Defer App/store evaluation as well as rendering: language is ready before
// library restoration, audio hooks or module-level UI factories can run.
async function startApp() {
  await initializeLanguage()
  const { default: App } = await import('./App')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>
  )
}
void startApp()
