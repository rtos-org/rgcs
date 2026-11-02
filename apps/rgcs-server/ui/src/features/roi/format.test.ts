import { describe, expect, it } from 'vitest'
import type { RoiStatus } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { roiText } from './format'

const status: RoiStatus = {
  active_target: 'roi_1', mode: 'rate', bearing_deg: 123.4, elevation_deg: -5, distance_m: 412.3, yaw_cmd_deg: 0, pitch_cmd_deg: 0,
  gimbal_yaw_deg: 0, gimbal_pitch_deg: 0, speed_yaw: 0, speed_pitch: 0, error: null,
}

describe('roiText', () => {
  it('shows the name, bearing and distance', () => {
    expect(roiText('送電塔 A', status, t('ja'))).toBe('送電塔 A  方位 123°  412 m')
    expect(roiText('Tower', status, t('en'))).toBe('Tower  Bearing 123°  412 m')
  })

  it('shows the translated error instead', () => {
    expect(roiText('送電塔 A', { ...status, error: 'target_too_close' }, t('ja'))).toBe('送電塔 A  目標が近すぎます')
    expect(roiText('X', { ...status, error: 'mystery' }, t('ja'))).toBe('X  mystery')
  })

  it('is the name only without a status or numbers', () => {
    expect(roiText('送電塔 A', undefined, t('ja'))).toBe('送電塔 A')
    expect(roiText('送電塔 A', { ...status, bearing_deg: null, distance_m: null }, t('ja'))).toBe('送電塔 A')
  })
})
