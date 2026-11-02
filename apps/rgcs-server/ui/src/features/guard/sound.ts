// The alert tone: a Web Audio two-tone, 880 Hz then 660 Hz,
// 150 ms each, no audio assets. Browsers block audio until a user gesture, so the AudioContext is
// created on the first pointer / key press (`audioUnlock`); until then `ready()` is false and the
// banner asks for a click. The per-browser mute lives in localStorage behind try/catch.

export interface Tone {
  readonly play: () => void
  /** False while the browser has not allowed audio yet (no gesture) or has no Web Audio. */
  readonly ready: () => boolean
}

const NOTES: readonly number[] = [880, 660]
const NOTE_S = 0.15
const LEVEL = 0.25

function safe(ctx: () => AudioContext | null): AudioContext | null {
  try {
    return ctx()
  } catch {
    return null
  }
}

function note(ac: AudioContext, freq: number, at: number): void {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(LEVEL, at)
  gain.gain.linearRampToValueAtTime(0, at + NOTE_S)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(at)
  osc.stop(at + NOTE_S)
}

export function webAudioTone(ctx: () => AudioContext | null = sharedAudio.get): Tone {
  return {
    ready: () => safe(ctx) !== null,
    play: () => {
      const ac = safe(ctx)
      if (!ac) return
      try {
        if (ac.state === 'suspended') void ac.resume().catch(() => {})
        NOTES.forEach((f, i) => note(ac, f, ac.currentTime + i * NOTE_S))
      } catch {
        // a closed or broken context: stay silent rather than break the banner
      }
    },
  }
}

export interface AudioUnlock {
  readonly get: () => AudioContext | null
}

function defaultContext(): AudioContext | null {
  const w = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  return Ctor ? new Ctor() : null
}

const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const

/** Creates the AudioContext inside the first user gesture on `target` (browser autoplay policy). */
export function audioUnlock(target: EventTarget | null, create: () => AudioContext | null = defaultContext): AudioUnlock {
  let ctx: AudioContext | null = null
  const onGesture = () => {
    GESTURES.forEach((g) => target?.removeEventListener(g, onGesture, true))
    try {
      ctx = create()
      if (ctx?.state === 'suspended') void ctx.resume().catch(() => {})
    } catch {
      ctx = null
    }
  }
  GESTURES.forEach((g) => target?.addEventListener(g, onGesture, true))
  return { get: () => ctx }
}

/** The page-wide unlock, armed when this module loads. */
export const sharedAudio: AudioUnlock = audioUnlock(typeof window === 'undefined' ? null : window)

const MUTE_KEY = 'rgcs.guard.muted'

function storage(s?: Storage): Storage | null {
  try {
    return s ?? globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function loadMuted(s?: Storage): boolean {
  try {
    return storage(s)?.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMuted(muted: boolean, s?: Storage): void {
  try {
    storage(s)?.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // private mode / blocked storage: the mute lasts for this page only
  }
}
