import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'

const players: { url: string; started: boolean; stopped: boolean; opts: { onState?: (s: unknown) => void } }[] = []
vi.mock('../../shared/video/whep', () => ({
  WhepPlayer: class {
    url: string
    opts: { onState?: (s: unknown) => void }
    started = false
    stopped = false
    constructor(_video: HTMLVideoElement, url: string, opts: { onState?: (s: unknown) => void }) {
      this.url = url
      this.opts = opts
      players.push(this)
    }
    start() {
      this.started = true
    }
    stop() {
      this.stopped = true
    }
    getState() {
      return { phase: 'idle', attempt: 0, holdFrame: false, lastError: null }
    }
  },
}))

const { VideoThumb } = await import('./VideoThumb')
const live = { mode: 'auto' as const, source: 'mt11' as const, scanning: false, probe_ok: true, whep_path: 'mt11' }
const down = { ...live, source: 'none' as const, scanning: true, probe_ok: false }

describe('VideoThumb', () => {
  beforeEach(() => {
    players.length = 0
  })

  it('starts a WHEP player for the vehicle when a source is live and stops it on unmount', () => {
    const { unmount } = render(<VideoThumb sysid={3} status={live} recording="idle" dict={t('ja')} />)
    expect(players).toHaveLength(1)
    expect(players[0]!.url).toBe('/api/vehicles/3/video/whep')
    expect(players[0]!.started).toBe(true)
    expect(screen.queryByText('映像未接続')).not.toBeInTheDocument()
    unmount()
    expect(players[0]!.stopped).toBe(true)
  })

  it('shows 映像未接続 without a source and the REC pill while recording', () => {
    const { rerender } = render(<VideoThumb sysid={3} status={down} recording="idle" dict={t('ja')} />)
    expect(screen.getByText('映像未接続')).toBeInTheDocument()
    expect(players).toHaveLength(0)
    rerender(<VideoThumb sysid={3} status={live} recording="recording" dict={t('ja')} />)
    expect(screen.getByText(/REC/)).toBeInTheDocument()
  })

  it('shows the reconnecting badge from the player state', () => {
    render(<VideoThumb sysid={3} status={live} recording="idle" dict={t('ja')} />)
    act(() => players[0]!.opts.onState?.({ phase: 'reconnecting', attempt: 1, holdFrame: true, lastError: 'ice_failed' }))
    expect(screen.getByText('再接続中')).toBeInTheDocument()
  })
  it('video_type_segment_sits_on_the_thumbnail', () => {
    const onMode = vi.fn()
    const { container, rerender } = render(<VideoThumb sysid={3} status={live} recording="idle" dict={t('ja')} modes={['rgb', 'thermal', 'side_by_side']} mode="rgb" onMode={onMode} />)
    const seg = container.querySelector('.detail-video > .seg.n3.sm.onmap') as HTMLElement
    expect(seg).not.toBeNull()
    expect(seg.style).toMatchObject({ position: 'absolute', left: '10px', bottom: '10px', width: '168px' })
    expect([...seg.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['RGB', 'IR', '2画面'])
    expect(seg.querySelector('button.on')).toHaveTextContent('RGB')
    screen.getByRole('button', { name: 'IR' }).click()
    expect(onMode).toHaveBeenCalledWith('thermal')
    rerender(<VideoThumb sysid={3} status={live} recording="idle" dict={t('ja')} modes={['rgb']} mode="rgb" onMode={onMode} />)
    expect(container.querySelector('.seg')).toBeNull()
  })
  it('the maximize button opens the camera cockpit and stays disabled without a handler', () => {
    const onMaximize = vi.fn()
    const { rerender } = render(<VideoThumb sysid={3} status={live} recording="idle" dict={t('ja')} onMaximize={onMaximize} />)
    screen.getByRole('button', { name: '最大化' }).click()
    expect(onMaximize).toHaveBeenCalledOnce()
    rerender(<VideoThumb sysid={3} status={live} recording="idle" dict={t('ja')} />)
    expect(screen.getByRole('button', { name: '最大化' })).toBeDisabled()
  })
})
