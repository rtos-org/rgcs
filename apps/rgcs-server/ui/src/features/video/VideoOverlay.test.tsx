import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CameraState, Detection } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { VideoOverlay } from './VideoOverlay'

const base: CameraState = {
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 30, video_mode: 'rgb', gimbal: null, gimbal_mode: null,
  stream: [1920, 1080], encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
}
const rect = { x: 0, y: 0, w: 1000, h: 562.5 }
const dict = t('ja')
const det = (x0: number): Detection => ({ x0, y0: 0.1, x1: x0 + 0.1, y1: 0.3, score: 0.9, class_id: 0, class_name: 'person' })
const show = (state: CameraState, thermalOverlay = true, preview: { x: number; y: number; w: number; h: number } | null = null) =>
  render(<VideoOverlay state={state} rect={rect} thermalOverlay={thermalOverlay} preview={preview} dict={dict} />)

describe('VideoOverlay (prototype 757–762)', () => {
  it('draws a tracking box with its tag', () => {
    show({ ...base, track: { status: 'tracking', rect: { x: 0.45, y: 0.2, w: 0.1, h: 0.2 }, target: '', age_ms: 0 } })
    const box = document.querySelector('.cockpit-overlay .trk.tracking') as HTMLElement
    expect(box.style.left).toBe('450px')
    expect(box.style.width).toBe('100px')
    expect(box.querySelector('.tag')?.textContent).toBe('追跡中')
  })

  it('draws a lost box for searching / lost', () => {
    show({ ...base, track: { status: 'lost', rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, target: '', age_ms: 0 } })
    expect(document.querySelector('.trk.lost .tag')?.textContent).toBe('見失い')
  })

  it('draws the hot / cold markers in IR with the overlay on', () => {
    const thermal = { gain: 'high' as const, range_c: null, frame: { max_c: 68.4, min_c: 11.2, max_xy: [960, 540] as [number, number], min_xy: [480, 270] as [number, number] }, point: null }
    show({ ...base, video_mode: 'thermal', thermal })
    const hot = document.querySelector('.tmark.hot') as HTMLElement
    expect(hot.textContent).toBe('68.4℃')
    expect(hot.style.left).toBe('500px')
    expect(document.querySelector('.tmark.cold')?.textContent).toBe('11.2℃')
  })

  it('draws no temperature markers while the stream size is degenerate', () => {
    const thermal = { gain: 'high' as const, range_c: null, frame: { max_c: 68.4, min_c: 11.2, max_xy: [960, 540] as [number, number], min_xy: [480, 270] as [number, number] }, point: null }
    show({ ...base, video_mode: 'thermal', thermal, stream: [0, 0] })
    expect(document.querySelectorAll('.tmark')).toHaveLength(0)
  })

  it('draws a plain marker for the measured point', () => {
    const thermal = { gain: 'high' as const, range_c: null, frame: null, point: { temp_c: 16, xy: [960, 540] as [number, number], age_ms: 0 } }
    show({ ...base, video_mode: 'thermal', thermal })
    const marks = [...document.querySelectorAll('.tmark')]
    expect(marks).toHaveLength(1)
    expect(marks[0]!.className).toBe('tmark')
    expect(marks[0]!.textContent).toBe('16.0℃')
  })

  it('draws no temperatures with the overlay off or outside IR', () => {
    const thermal = { gain: 'high' as const, range_c: null, frame: { max_c: 68.4, min_c: 11.2, max_xy: [1, 1] as [number, number], min_xy: [2, 2] as [number, number] }, point: null }
    show({ ...base, video_mode: 'thermal', thermal }, false)
    expect(document.querySelector('.tmark')).toBeNull()
  })

  it('draws the detection boxes in RGB only', () => {
    const { unmount } = show({ ...base, candidates: [det(0.1), det(0.5)] })
    expect(document.querySelectorAll('.cand')).toHaveLength(2)
    unmount()
    show({ ...base, video_mode: 'thermal', candidates: [det(0.1)] })
    expect(document.querySelectorAll('.cand')).toHaveLength(0)
  })

  it('shows the click preview until a track arrives', () => {
    const preview = { x: 10, y: 20, w: 30, h: 40 }
    const { unmount } = show(base, true, preview)
    const box = document.querySelector('.trk') as HTMLElement
    expect(box.className).toBe('trk')
    expect(box.style.top).toBe('20px')
    unmount()
    show({ ...base, track: { status: 'tracking', rect: { x: 0.45, y: 0.2, w: 0.1, h: 0.2 }, target: '', age_ms: 0 } }, true, preview)
    expect(document.querySelectorAll('.trk')).toHaveLength(1)
  })
})
