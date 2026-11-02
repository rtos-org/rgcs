import { describe, expect, it } from 'vitest'
import { ZOOM_SLIDER_MAX, dialOffset, gimbalText, latencyText, posToZoom, zoomToPos } from './cockpitView'

describe('camera cockpit helpers', () => {
  it('maps zoom to a logarithmic 0..1000 slider and back', () => {
    expect(zoomToPos(1, 165)).toBe(0)
    expect(zoomToPos(165, 165)).toBe(1000)
    expect(zoomToPos(Math.sqrt(165), 165)).toBe(500)
    expect(posToZoom(0, 165)).toBe(1)
    expect(posToZoom(1000, 165)).toBe(165)
    expect(posToZoom(500, 165)).toBeCloseTo(12.8, 1)
  })
  it('a percent zoom maps linearly 0..100 % to the slider', () => {
    expect(zoomToPos(50, 100, 'percent')).toBe(ZOOM_SLIDER_MAX / 2)
    expect(zoomToPos(0, 100, 'percent')).toBe(0)
    expect(zoomToPos(100, 100, 'percent')).toBe(ZOOM_SLIDER_MAX)
    expect(posToZoom(ZOOM_SLIDER_MAX, 100, 'percent')).toBe(100)
    expect(posToZoom(0, 100, 'percent')).toBe(0)
    expect(posToZoom(333, 100, 'percent')).toBe(33)
  })
  it('a camera without optical zoom range sits at the left end', () => {
    expect(zoomToPos(1, 1)).toBe(0)
    expect(posToZoom(700, 1)).toBe(1)
  })
  it('projects yaw across and pitch up the dial, ±90° to the 36 px rim', () => {
    expect(dialOffset(null)).toEqual({ x: 0, y: 0 })
    expect(dialOffset({ yaw: 45, pitch: -90 })).toEqual({ x: 18, y: 36 })
    expect(dialOffset({ yaw: -135, pitch: 30 })).toEqual({ x: -36, y: -12 })
  })
  it('writes the gimbal row as mode then yaw / pitch', () => {
    expect(gimbalText('follow', { yaw: -12, pitch: -30.04 })).toBe('Follow  −12.0° / −30.0°')
    expect(gimbalText(null, null)).toBe('—')
  })
  it('shows the measured receive delay: jitter buffer plus half the round trip', () => {
    expect(latencyText({ jitter: 80, rtt: 40 })).toBe('100 ms')
    expect(latencyText({ jitter: null, rtt: null })).toBe('— ms')
    expect(latencyText(null)).toBe('— ms')
  })
})
