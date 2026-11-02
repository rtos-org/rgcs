import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CameraCaps, CameraState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { CameraStatusRow } from './CameraStatusRow'

const none: CameraCaps = { kind: 'none', gimbal: null, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: null, roi: 'none', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false }
const mt11: CameraCaps = { ...none, kind: 'siyi_mt11', gimbal: { rate: true, angle: true, center: true, modes: ['lock'], attitude: true, pitch_range: [-90, 30] } }
const st = (over: Partial<CameraState>): CameraState => ({
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 165, video_mode: 'rgb', gimbal: { yaw: 12.3, pitch: -30, roll: 0, age_ms: 0 }, gimbal_mode: 'lock', stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null, ...over,
})

describe('CameraStatusRow', () => {
  it('offers setup when no camera is configured', () => {
    const onSetup = vi.fn()
    render(<CameraStatusRow caps={none} state={st({})} onSetup={onSetup} dict={t('ja')} />)
    expect(screen.getByText('カメラ未設定')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '設定する' }))
    expect(onSetup).toHaveBeenCalledTimes(1)
  })

  it('shows mode and gimbal angles, or 切断 when offline', () => {
    const { rerender } = render(<CameraStatusRow caps={mt11} state={st({})} onSetup={() => {}} dict={t('ja')} />)
    // mode in words, pan / tilt behind Lucide icons, no ↔ ↕ glyphs
    expect(screen.getByTestId('cam-status')).toHaveTextContent('ロック')
    expect(screen.getByTitle('パン')).toHaveTextContent('12.3°')
    expect(screen.getByTitle('チルト')).toHaveTextContent('−30.0°')
    expect(screen.getByTestId('cam-status')).not.toHaveTextContent('↔')
    rerender(<CameraStatusRow caps={mt11} state={st({ connected: false })} onSetup={() => {}} dict={t('ja')} />)
    expect(screen.getByTestId('cam-status')).toHaveTextContent('切断')
  })

  it('a MAVLink camera reads MAVLink カメラ | pan / tilt with no mode cell', () => {
    const mav: CameraCaps = { ...none, kind: 'mavlink', gimbal: { rate: true, angle: true, center: true, modes: [], attitude: true, pitch_range: [-90, 30] }, roi: 'native' }
    render(<CameraStatusRow caps={mav} state={st({ gimbal: { yaw: 0, pitch: -20, roll: 0, age_ms: 0 }, gimbal_mode: null })} onSetup={() => {}} dict={t('ja')} />)
    const row = screen.getByTestId('cam-status')
    expect(row).toHaveTextContent('MAVLink カメラ')
    expect(screen.getByTitle('パン')).toHaveTextContent('0.0°')
    expect(screen.getByTitle('チルト')).toHaveTextContent('−20.0°')
    expect(row).not.toHaveTextContent('追従')
    expect(row).not.toHaveTextContent('—')
    expect(screen.getByText('MAVLink カメラ').nextElementSibling).toHaveClass('sep')
  })

  it('adds the active ROI name after a separator', () => {
    const { rerender } = render(<CameraStatusRow caps={mt11} state={st({})} onSetup={() => {}} dict={t('ja')} roiName="送電塔 A" />)
    const row = screen.getByTestId('cam-status')
    expect(row).toHaveTextContent('ROI 送電塔 A')
    const roi = screen.getByText('ROI 送電塔 A')
    expect(roi.previousElementSibling).toHaveClass('sep')
    rerender(<CameraStatusRow caps={mt11} state={st({})} onSetup={() => {}} dict={t('ja')} />)
    expect(screen.getByTestId('cam-status')).not.toHaveTextContent('ROI')
  })

  it('adds the tracking state after a separator; lost / searching are cautions', () => {
    const track = (status: 'tracking' | 'searching' | 'lost') => ({ status, rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, target: 'person', age_ms: 0 })
    const { rerender } = render(<CameraStatusRow caps={mt11} state={st({ track: track('tracking') })} onSetup={() => {}} dict={t('ja')} roiName="送電塔 A" />)
    const trk = screen.getByText('追跡中')
    expect(trk.previousElementSibling).toHaveClass('sep')
    expect(trk).not.toHaveClass('caution')
    rerender(<CameraStatusRow caps={mt11} state={st({ track: track('lost') })} onSetup={() => {}} dict={t('ja')} />)
    expect(screen.getByText('見失い')).toHaveClass('caution')
    rerender(<CameraStatusRow caps={mt11} state={st({ track: track('searching') })} onSetup={() => {}} dict={t('ja')} />)
    expect(screen.getByText('再捕捉中')).toHaveClass('caution')
    rerender(<CameraStatusRow caps={mt11} state={st({})} onSetup={() => {}} dict={t('ja')} />)
    expect(screen.queryByText('追跡中')).toBeNull()
  })
})
