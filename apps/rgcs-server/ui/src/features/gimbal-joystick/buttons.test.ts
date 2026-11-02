import { describe, expect, it } from 'vitest'
import type { CameraState } from '../../shared/api/types'
import { buttonAction, buttonCommand, releaseCommand } from './buttons'

describe('buttonAction', () => {
  it('roi_N starts that preset, or stops it when it is the active one', () => {
    expect(buttonAction('roi_3', null, null)).toEqual({ kind: 'roi_start', id: 'roi_3' })
    expect(buttonAction('roi_3', null, 'roi_3')).toEqual({ kind: 'roi_stop' })
    expect(buttonAction('roi_3', null, 'roi_1')).toEqual({ kind: 'roi_start', id: 'roi_3' })
    expect(buttonAction('roi_10', null, null)).toEqual({ kind: 'roi_start', id: 'roi_10' })
  })

  it('roi_stop stops only while active', () => {
    expect(buttonAction('roi_stop', null, null)).toBeNull()
    expect(buttonAction('roi_stop', null, 'roi_2')).toEqual({ kind: 'roi_stop' })
  })

  it('camera functions become camera commands', () => {
    expect(buttonAction('shutter', null, null)).toEqual({ kind: 'camera', cmd: { cmd: 'photo' } })
    expect(buttonAction('none', null, 'roi_1')).toBeNull()
    expect(buttonAction('gimbal_stop', null, null)).toBeNull()
  })
})

const cam: CameraState = {
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 30, video_mode: 'rgb', gimbal: null, gimbal_mode: null,
  stream: [1920, 1080], encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
}

describe('media button functions', () => {
  it('thermal_gain_toggle flips the gain; unknown → high', () => {
    const high = { ...cam, thermal: { gain: 'high' as const, range_c: null, frame: null, point: null } }
    expect(buttonCommand('thermal_gain_toggle', high)).toEqual({ cmd: 'thermal_gain', args: { gain: 'low' } })
    expect(buttonCommand('thermal_gain_toggle', cam)).toEqual({ cmd: 'thermal_gain', args: { gain: 'high' } })
    expect(buttonCommand('thermal_gain_toggle', null)).toEqual({ cmd: 'thermal_gain', args: { gain: 'high' } })
  })

  it('ai_tracking_toggle cancels while tracking, else starts a 200 px box at the centre', () => {
    const tracking = { ...cam, track: { status: 'tracking' as const, rect: { x: 0, y: 0, w: 0.1, h: 0.1 }, target: '', age_ms: 0 } }
    expect(buttonCommand('ai_tracking_toggle', tracking)).toEqual({ cmd: 'ai_cancel' })
    expect(buttonCommand('ai_tracking_toggle', cam)).toEqual({ cmd: 'ai_select_box', args: { x: 0.5, y: 0.5, box_px: 200 } })
  })

  it('focus_near / focus_far drive focus while held and stop on release', () => {
    expect(buttonCommand('focus_near', cam)).toEqual({ cmd: 'focus', args: { dir: -1 } })
    expect(buttonCommand('focus_far', cam)).toEqual({ cmd: 'focus', args: { dir: 1 } })
    expect(releaseCommand('focus_far')).toEqual({ cmd: 'focus', args: { dir: 0 } })
    expect(releaseCommand('focus_near')).toEqual({ cmd: 'focus', args: { dir: 0 } })
    expect(releaseCommand('shutter')).toBeNull()
  })
})
