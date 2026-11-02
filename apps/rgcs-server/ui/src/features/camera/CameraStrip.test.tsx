import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CameraCaps, CameraState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CameraStrip } from './CameraStrip'

const mt11: CameraCaps = {
  kind: 'siyi_mt11',
  gimbal: { rate: true, angle: true, center: true, modes: ['lock', 'follow', 'fpv'], attitude: true, pitch_range: [-90, 30] },
  zoom: { max: 165, absolute: true, step: true, continuous: true, unit: 'times' },
  focus: true,
  photo: true,
  record: true,
  video_modes: ['rgb', 'thermal', 'side_by_side'],
  hfov_deg: 62, roi: 'computed', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false,
}
const state = (over: Partial<CameraState> = {}): CameraState => ({
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 2.5, zoom_max: 165, video_mode: 'rgb', gimbal: null, gimbal_mode: 'follow', stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null, ...over,
})
const none: CameraCaps = { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: null, roi: 'none', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false }

const mav: CameraCaps = {
  ...none, kind: 'mavlink', photo: true, record: true, video_modes: ['rgb'], roi: 'native',
  gimbal: { rate: true, angle: true, center: true, modes: [], attitude: true, pitch_range: [-90, 30] },
  zoom: { max: 100, absolute: true, step: true, continuous: true, unit: 'percent' },
}

describe('CameraStrip', () => {
  it('a MAVLink camera shows record, photo, − 40% + and the gear only', () => {
    const { container } = render(<CameraStrip caps={mav} state={state({ zoom: 40, zoom_max: 100, gimbal_mode: null })} pending={false} onCommand={() => {}} onSettings={() => {}} dict={t('ja')} />)
    expect([...container.querySelectorAll('.cam-strip > *')].map((e) => e.getAttribute('aria-label') ?? e.className)).toEqual(['録画', '写真', 'zstep', 'grow', 'カメラ設定'])
    expect(container.querySelector('.zstep span.big.num')).toHaveTextContent('40%')
    expect(screen.queryByRole('group', { name: '映像タイプ' })).toBeNull()
  })

  it('renders nothing for kind none and hides the video type segment when only rgb', () => {
    const { container, rerender } = render(<CameraStrip caps={none} state={state()} pending={false} onCommand={() => {}} onSettings={() => {}} dict={t('ja')} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<CameraStrip caps={{ ...mt11, video_modes: ['rgb'] }} state={state()} pending={false} onCommand={() => {}} onSettings={() => {}} dict={t('ja')} />)
    expect(screen.queryByRole('group', { name: '映像タイプ' })).not.toBeInTheDocument()
    expect(screen.getByText('2.5×')).toBeInTheDocument()
  })

  it('sends zoom steps, photo, record toggle and video type', () => {
    const onCommand = vi.fn()
    render(<CameraStrip caps={mt11} state={state()} pending={false} onCommand={onCommand} onSettings={() => {}} dict={t('ja')} />)
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'zoom_step', args: { steps: 1 } })
    fireEvent.click(screen.getByRole('button', { name: 'ズームアウト' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'zoom_step', args: { steps: -1 } })
    fireEvent.click(screen.getByRole('button', { name: '写真' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'photo' })
    fireEvent.click(screen.getByRole('button', { name: '録画' }))
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'record_start' })
  })

  it('zoom_is_a_stepper_with_icons', () => {
    const { container } = render(<CameraStrip caps={mt11} state={state({ zoom: 165 })} pending={false} onCommand={() => {}} onSettings={() => {}} dict={t('ja')} />)
    const step = container.querySelector('.cam-strip > .zstep')!
    expect(step).not.toBeNull()
    expect([...step.children].map((c) => c.tagName)).toEqual(['BUTTON', 'SPAN', 'BUTTON'])
    expect(step.querySelector('span.big.num')).toHaveTextContent('165.0×')
    step.querySelectorAll('button').forEach((b) => expect(b.querySelector('svg.ic')).not.toBeNull())
    expect(step).not.toHaveTextContent(/[−+]/)
    expect(container.querySelector('.cam-strip > .grow')).not.toBeNull()
  })

  it('no_video_type_segment_in_the_strip', () => {
    render(<CameraStrip caps={mt11} state={state()} pending={false} onCommand={() => {}} onSettings={() => {}} dict={t('ja')} />)
    expect(screen.queryByRole('group', { name: '映像タイプ' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'IR' })).toBeNull()
  })

  it('shows record on while recording, sends record_stop, and is disabled while pending', () => {
    const onCommand = vi.fn()
    const onSettings = vi.fn()
    const { rerender } = render(<CameraStrip caps={mt11} state={state({ recording: 'recording' })} pending={false} onCommand={onCommand} onSettings={onSettings} dict={t('ja')} />)
    const rec = screen.getByRole('button', { name: '録画' })
    expect(rec).toHaveClass('on')
    fireEvent.click(rec)
    expect(onCommand).toHaveBeenLastCalledWith({ cmd: 'record_stop' })
    rerender(<CameraStrip caps={mt11} state={state({ recording: 'recording' })} pending={true} onCommand={onCommand} onSettings={onSettings} dict={t('ja')} />)
    expect(screen.getByRole('button', { name: '録画' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'カメラ設定' }))
    expect(onSettings).toHaveBeenCalledTimes(1)
  })
})
