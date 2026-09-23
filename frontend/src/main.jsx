import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider } from '@mantine/core'

// Bundled fonts — work offline (while driving, no signal).
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource/lora'

import '@mantine/core/styles.css'
import './styles.css'

import { theme } from './theme.js'
import App from './App.jsx'

// Register the service worker for offline shell + iOS "Add to Home Screen".
if ('serviceWorker' in navigator) {
  // A new worker taking control means a new build is live, but this page is
  // still running the previous bundle — reload once so a deploy lands on the
  // first launch instead of the second. Guarded on there having been a
  // controller already, so the very first install doesn't reload.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[vesper] Service worker registration failed:', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark" forceColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>
)
