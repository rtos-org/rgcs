import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
// UI fonts ship with RGCS (no CDN): the weights the styles use. Glyph ranges load on demand.
import '@fontsource/ibm-plex-sans-jp/300.css'
import '@fontsource/ibm-plex-sans-jp/400.css'
import '@fontsource/ibm-plex-sans-jp/500.css'
import '@fontsource/ibm-plex-sans-jp/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/prototype.css'
import './styles/app.css'
import './styles/present.css'
import './styles/mission.css'
import './styles/maint.css'
import './styles/logbook.css'
import './styles/calib.css'
import './styles/plans.css'
import './styles/survey.css'
import './styles/ai.css'
import './styles/instruments.css'
import './styles/network.css'
import './styles/login.css'
import './styles/guard.css'
import './styles/env.css'
import './styles/assign.css'
import './styles/overlays.css'
import { App } from './app/App'
import { PresentApp } from './present'
import { authStore } from './features/auth/store'
import { setUnauthorizedHandler } from './shared/api/client'

// `/present` is the audience view: no session, no auth gate, never the login screen.
const isPresent = window.location.pathname.startsWith('/present')
if (!isPresent) setUnauthorizedHandler(() => authStore.setAnon())
const token = new URLSearchParams(window.location.search).get('t') ?? ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPresent ? <PresentApp token={token} /> : <App />}</StrictMode>,
)
