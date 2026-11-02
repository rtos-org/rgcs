import { describe, expect, it, vi } from 'vitest'
import { audioUnlock, loadMuted, saveMuted, webAudioTone } from './sound'

function fakeContext() {
  const oscs: { freq: number; start: number; stop: number; type: string }[] = []
  const ctx = {
    currentTime: 2,
    state: 'running',
    resume: vi.fn(() => Promise.resolve()),
    destination: {},
    createOscillator: () => {
      const o = { type: '', frequency: { value: 0 }, connect: (n: unknown) => n, start: (t: number) => oscs.push({ freq: o.frequency.value, start: t, stop: 0, type: o.type }), stop: (t: number) => (oscs.at(-1)!.stop = t) }
      return o
    },
    createGain: () => ({ gain: { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: (n: unknown) => n }),
  }
  return { ctx: ctx as unknown as AudioContext, oscs }
}

describe('webAudioTone', () => {
  it('plays 880 Hz then 660 Hz, 150 ms each', () => {
    const { ctx, oscs } = fakeContext()
    webAudioTone(() => ctx).play()
    expect(oscs.map((o) => o.freq)).toEqual([880, 660])
    expect(oscs[0]!.start).toBeCloseTo(2)
    expect(oscs[0]!.stop).toBeCloseTo(2.15)
    expect(oscs[1]!.start).toBeCloseTo(2.15)
    expect(oscs[1]!.stop).toBeCloseTo(2.3)
  })

  it('is a no-op without an AudioContext and never throws', () => {
    expect(() => webAudioTone(() => null).play()).not.toThrow()
    expect(() =>
      webAudioTone(() => {
        throw new Error('blocked')
      }).play(),
    ).not.toThrow()
  })

  it('reports readiness from the context factory', () => {
    const { ctx } = fakeContext()
    expect(webAudioTone(() => null).ready()).toBe(false)
    expect(webAudioTone(() => ctx).ready()).toBe(true)
  })
})

describe('audioUnlock', () => {
  it('creates the context only on the first user gesture', () => {
    const target = document.createElement('div')
    const create = vi.fn(() => fakeContext().ctx)
    const unlock = audioUnlock(target, create)
    expect(unlock.get()).toBeNull()
    expect(create).not.toHaveBeenCalled()
    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(new Event('keydown'))
    expect(create).toHaveBeenCalledTimes(1)
    expect(unlock.get()).not.toBeNull()
  })

  it('stays null when the browser has no Web Audio', () => {
    const target = document.createElement('div')
    const unlock = audioUnlock(target, () => null)
    target.dispatchEvent(new Event('pointerdown'))
    expect(unlock.get()).toBeNull()
  })
})

describe('mute storage', () => {
  it('round-trips through storage', () => {
    const data = new Map<string, string>()
    const s = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as unknown as Storage
    expect(loadMuted(s)).toBe(false)
    saveMuted(true, s)
    expect(loadMuted(s)).toBe(true)
  })

  it('survives a storage that throws', () => {
    const s = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(loadMuted(s)).toBe(false)
    expect(() => saveMuted(true, s)).not.toThrow()
  })
})
