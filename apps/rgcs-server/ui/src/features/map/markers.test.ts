import { describe, expect, it } from 'vitest'
import type { CameraSnapshot, VehicleState } from '../../shared/api/types'
import { hfovAt } from './gimbal'
import { DEFAULT_HFOV_DEG, gimbalPose, hasPosition, homeEl, markerEl, updateMarkerEl } from './markers'

const base: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed: true, lat: 35.481883, lon: 138.48029, alt_rel: 80, alt_msl: 480,
  hdg: 90, ground_speed: 5, climb: 0, battery: { pct: 70, volt: 23, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}

describe('vehicle markers', () => {
  it('hasPosition needs a 2D+ fix and a non-null-island position', () => {
    expect(hasPosition(base)).toBe(true)
    expect(hasPosition({ ...base, gps: { ...base.gps, fix: 1 } })).toBe(false)
    expect(hasPosition({ ...base, lat: 0, lon: 0 })).toBe(false)
  })

  it('copter_marker_has_disc_heading_caret_and_label', () => {
    const el = markerEl(base, false)
    expect([...el.classList]).toEqual(['rg-mk'])
    const vmk = el.querySelector('.vmk')!
    expect([...vmk.classList]).toEqual(['vmk', 'copter'])
    expect(vmk.querySelector('.arrow > i.hd')).not.toBeNull()
    expect(vmk.querySelector('.disc > svg.ic')).not.toBeNull()
    expect(vmk.querySelector('.disc circle')).not.toBeNull()
    expect(el.querySelector('.lbl')?.textContent).toBe('UAV-01')
    expect(el.querySelector('.alt')?.textContent).toBe('80 m')
    expect(el.title).toBe('UAV-01')
  })

  it('plane_marker_uses_the_lucide_plane', () => {
    const el = markerEl({ ...base, kind: 'plane' }, false)
    expect([...el.querySelector('.vmk')!.classList]).toEqual(['vmk', 'plane'])
    expect(el.querySelector('.disc path')!.getAttribute('d')).toMatch(/^M17\.8 19\.2/)
  })

  it('the plane icon turns with the heading like the caret (Lucide draws it nose to 45°)', () => {
    const el = markerEl({ ...base, kind: 'plane', hdg: 90 }, false)
    const ic = () => el.querySelector<SVGElement>('.disc .ic')!
    expect(ic().style.transform).toBe('rotate(45deg)')
    updateMarkerEl(el, { ...base, kind: 'plane', hdg: 270 }, false)
    expect(ic().style.transform).toBe('rotate(225deg)')
    // the multicopter is round: it stays put
    expect(markerEl({ ...base, hdg: 90 }, false).querySelector<SVGElement>('.disc .ic')!.style.transform).toBe('')
  })

  it('rover_marker_uses_car_and_light_disc', () => {
    const el = markerEl({ ...base, kind: 'rover' }, false)
    expect([...el.querySelector('.vmk')!.classList]).toEqual(['vmk', 'rover'])
    expect(el.querySelector('.arrow > .hd')).not.toBeNull()
    expect([...el.querySelectorAll('.disc path')].map((p) => p.getAttribute('d'))).toContain('M9 17h6')
  })

  it('selected_marker_gets_sel and warnings mark the label, without replacing the element', () => {
    const el = markerEl(base, false)
    el.classList.add('maplibregl-marker') // MapLibre adds its positioning class after construction
    const same = updateMarkerEl(el, { ...base, warn: true, alt_rel: 12.4 }, true)
    expect(same).toBe(el)
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'rg-mk', 'sel', 'warn'])
    expect(el.querySelector('.alt')?.textContent).toBe('12 m')
    updateMarkerEl(el, base, false)
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'rg-mk'])
  })

  it('heading_rotates_only_the_arrow', () => {
    const el = markerEl(base, false)
    const arrow = el.querySelector('.arrow') as HTMLElement
    expect(arrow.style.transform).toBe('rotate(90deg)')
    expect((el.querySelector('.disc') as HTMLElement).style.transform).toBe('')
    expect((el.querySelector('.vmk') as HTMLElement).style.transform).toBe('')
    updateMarkerEl(el, { ...base, hdg: null }, false)
    // inline style: jsdom's computed style is cached on detached elements
    expect(arrow.style.transform).toBe('rotate(0deg)')
  })

  it('home_marker_is_a_white_tile_with_a_house', () => {
    const el = homeEl('UAV-01 のホーム')
    expect(el.className).toBe('rg-home')
    // whose home it is: four stacked tiles were indistinguishable
    expect(el.title).toBe('UAV-01 のホーム')
    expect(el.querySelector('svg.ic path')).not.toBeNull()
  })
  it('no_fan_without_attitude', () => {
    const el = markerEl(base, false, null)
    expect((el.querySelector('.vmk > svg.fov') as SVGElement).style.display).toBe('none')
  })

  it('fan_points_along_the_camera_bearing_and_becomes_a_ring_at_nadir', () => {
    const el = markerEl(base, false, { bearing: 60, hfov: 62, pitch: -20 })
    const fov = el.querySelector('.vmk > svg.fov') as SVGElement
    expect(fov.style.display).toBe('')
    expect(fov.style.transform).toBe('rotate(60deg)')
    expect(fov.querySelector('.cone')?.getAttribute('d')).toMatch(/^M120,120 L/)
    expect((fov.querySelector('.nadir') as SVGElement).style.display).toBe('none')
    updateMarkerEl(el, base, false, { bearing: 60, hfov: 62, pitch: -85 })
    expect((fov.querySelector('.cone') as SVGElement).style.display).toBe('none')
    expect((fov.querySelector('.nadir') as SVGElement).style.display).toBe('')
    expect(fov.querySelector('radialGradient')?.id).toBe('fovg-1')
  })

  it('gimbal_pose_needs_attitude_caps_and_an_attitude', () => {
    const caps = { kind: 'siyi_mt11', gimbal: { rate: true, angle: true, center: true, modes: [], attitude: true, pitch_range: [-90, 30] }, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: 62 } as const
    const state = { connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 2, zoom_max: 165, video_mode: null, gimbal: { yaw: 30, pitch: -10, roll: 0, age_ms: 0 }, gimbal_mode: null, stream: null } as const
    const cam = { sysid: 1, caps, state } as unknown as CameraSnapshot
    expect(gimbalPose(base, cam)).toEqual({ bearing: 60, hfov: hfovAt(62, 2), pitch: -10 })
    expect(gimbalPose(base, undefined)).toBeNull()
    expect(gimbalPose(base, { ...cam, state: { ...cam.state, gimbal: null } })).toBeNull()
    expect(gimbalPose(base, { ...cam, caps: { ...cam.caps, gimbal: { ...caps.gimbal, attitude: false } } } as unknown as CameraSnapshot)).toBeNull()
    expect(gimbalPose({ ...base, hdg: null }, cam)).toBeNull()
  })
  it('a percent zoom camera draws the fan at 1× (no multiplier known)', () => {
    const caps = { kind: 'mavlink', gimbal: { rate: true, angle: true, center: true, modes: [], attitude: true, pitch_range: [-90, 30] }, zoom: { max: 100, absolute: true, step: true, continuous: true, unit: 'percent' }, hfov_deg: null } as const
    const state = { connected: true, zoom: 80, gimbal: { yaw: 0, pitch: -20, roll: 0, age_ms: 0 } } as const
    const cam = { sysid: 1, caps, state } as unknown as CameraSnapshot
    expect(gimbalPose(base, cam)?.hfov).toBe(DEFAULT_HFOV_DEG)
  })
  it('selected_marker_has_lock_and_beacon_elements', () => {
    const el = markerEl(base, true)
    expect(el.querySelector('.vmk > i.lock')).not.toBeNull()
    expect(el.querySelector('.vmk > i.beacon')).not.toBeNull()
    expect(el).toHaveClass('sel')
  })

})
