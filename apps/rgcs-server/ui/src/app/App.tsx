import { startTransition, useEffect, useState } from 'react'
import { isScene, type Intro } from '../features/auth/intro'
import { introStore, prefersReducedMotion, useIntro, type IntroStore } from '../features/auth/introStore'
import { Login } from '../features/auth/Login'
import { LoginBackdrop, LoginOverlay } from '../features/auth/LoginScene'
import { authStore, useAuth, type AuthStore } from '../features/auth/store'
import { assignmentStore } from '../features/assign/store'
import { vehicleStore } from '../features/vehicles/store'
import { useLang } from '../shared/i18n/lang'
import { useTheme } from '../shared/theme/theme'
import { defaultWsUrl } from '../shared/ws/client'
import { Shell } from './Shell'

/** Close codes after which the session is re-checked: our own 4401, or an abnormal close
 *  (1006) which is what the browser reports when the `/ws` upgrade was refused with 401. */
const RECHECK_SESSION_CODES: ReadonlySet<number> = new Set([4401, 1006])

interface Props {
  /** Injected by tests; the app uses the singleton. */
  readonly store?: AuthStore
  /** Injected by tests; the app uses the singleton. */
  readonly intro?: IntroStore
}

/** `html[data-intro]` lets the app's panels play their entrance in CSS without re-rendering Shell. */
function introFlag(intro: Intro): string | null {
  if (intro.phase !== 'done' && intro.phase !== 'clear') return null
  return intro.reduced ? 'fade' : intro.phase
}

function useIntroFlag(intro: Intro): void {
  const flag = introFlag(intro)
  useEffect(() => {
    const root = document.documentElement
    if (flag === null) delete root.dataset.intro
    else root.dataset.intro = flag
  }, [flag])
  useEffect(() => () => void delete document.documentElement.dataset.intro, [])
}

/**
 * Mounting the shell (React tree + MapLibre) is the one heavy task of the transition. Under the
 * clouds it is rendered as a transition, so React slices it and the fade-out keeps its frames.
 */
function useSlicedMount(want: boolean): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    startTransition(() => setOn(want))
  }, [want])
  return want && on
}

export function App({ store = authStore, intro: introSource = introStore }: Props) {
  const auth = useAuth(store)
  const intro = useIntro(introSource)
  const theme = useTheme()
  const [lang] = useLang()
  useIntroFlag(intro)
  const playing = isScene(intro.phase)
  const underClouds = useSlicedMount(playing && intro.phase !== 'gather')

  useEffect(() => {
    void store.load()
  }, [store])

  useEffect(() => {
    if (auth.status !== 'authed') return
    // attached first: the connect's snapshot frame loads the assignment table
    const detach = assignmentStore.attach(vehicleStore)
    vehicleStore.connect(defaultWsUrl(), (code) => {
      if (RECHECK_SESSION_CODES.has(code)) void store.recheck()
    })
    return () => {
      vehicleStore.disconnect()
      detach()
    }
  }, [auth.status, store])

  if (auth.status === 'unknown') return null
  // A stored session (load) never starts the scene: the shell appears directly.
  const scene = auth.status === 'anon' || auth.me === null || playing
  // The app mounts at `done`, under full cloud cover; during `gather` it is not there yet.
  const me = auth.status === 'authed' && (playing ? underClouds : true) ? auth.me : null
  const phase = playing ? intro.phase : 'idle'
  const reduced = playing ? intro.reduced : prefersReducedMotion()
  return (
    <>
      {scene && <LoginBackdrop theme={theme} phase={phase} />}
      {me && <Shell me={me} lang={lang} />}
      {scene && (
        <LoginOverlay theme={theme} phase={phase} reduced={reduced}>
          <Login store={store} intro={introSource} />
        </LoginOverlay>
      )}
    </>
  )
}
