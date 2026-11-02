import { describe, expect, it } from 'vitest'
import type { CameraProfile, CameraState } from '../../shared/api/types'
import { firstIssue } from './schema'
import { ENCODING_IDS, PALETTES, startVideoDraft, videoSchema, videoSteps, type VideoDraft } from './videoSchema'

// CameraProfile::default_for (crates/rgcs-core/src/camera.rs) with an MT11 kind.
const profile: CameraProfile = {
  sysid: 1, kind: 'siyi_mt11', host: '192.168.144.25', port: 37260, rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100, video_source_mode: 'auto',
  android_url: 'http://127.0.0.1:8080', encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, clock_sync: true, auto_record: true,
}
const state = { thermal: { gain: 'high', range_c: [-20, 150], frame: null, point: null } } as unknown as CameraState
const draft = (over: Partial<VideoDraft> = {}): VideoDraft => ({ ...startVideoDraft(profile, state), ...over })
const issuePath = (d: VideoDraft) => firstIssue(videoSchema.safeParse(d))?.path

describe('videoSchema', () => {
  it('lists the five encoding presets and the eleven palettes of the prototype', () => {
    expect(ENCODING_IDS).toEqual(['h264_720p', 'h264_1080p', 'h264_4k', 'h265_1080p', 'h265_4k'])
    expect(PALETTES.map((p) => p.id)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(PALETTES[2]).toEqual({ id: 3, label: 'Ironbow' })
  })

  it('the profile defaults parse', () => {
    expect(videoSchema.safeParse(draft()).success).toBe(true)
    expect(draft()).toEqual({ encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, auto_record: true, gain: 'high' })
  })

  it('rejects a box outside 32..600 or fractional, and palette 1', () => {
    expect(issuePath(draft({ ai_box_px: 31 }))).toBe('ai_box_px')
    expect(issuePath(draft({ ai_box_px: 601 }))).toBe('ai_box_px')
    expect(issuePath(draft({ ai_box_px: 100.5 }))).toBe('ai_box_px')
    expect(issuePath(draft({ thermal_palette: 1 }))).toBe('thermal_palette')
  })

  it('the gain draft starts from the camera state (null when unknown)', () => {
    expect(startVideoDraft(profile, undefined).gain).toBeNull()
  })
})

describe('videoSteps', () => {
  it('nothing changed → no patch, no commands', () => {
    expect(videoSteps(profile, state, draft(), false)).toEqual({ patch: null, commands: [] })
  })

  it('encoding → patch + encoding command', () => {
    expect(videoSteps(profile, state, draft({ encoding_preset: 'h265_4k' }), false)).toEqual({
      patch: { encoding_preset: 'h265_4k' },
      commands: [{ cmd: 'encoding', args: { preset: 'h265_4k' } }],
    })
  })

  it('palette 3 → 5 → patch + thermal_palette command', () => {
    expect(videoSteps(profile, state, draft({ thermal_palette: 5 }), false)).toEqual({
      patch: { thermal_palette: 5 },
      commands: [{ cmd: 'thermal_palette', args: { palette: 5 } }],
    })
  })

  it('gain differing from state → only the thermal_gain command', () => {
    expect(videoSteps(profile, state, draft({ gain: 'low' }), false)).toEqual({ patch: null, commands: [{ cmd: 'thermal_gain', args: { gain: 'low' } }] })
  })

  it('box / overlay / auto record → patch only', () => {
    expect(videoSteps(profile, state, draft({ ai_box_px: 150, thermal_overlay: false, auto_record: false }), false)).toEqual({
      patch: { ai_box_px: 150, thermal_overlay: false, auto_record: false },
      commands: [],
    })
  })

  it('a connection change keeps the patch and drops the commands', () => {
    expect(videoSteps(profile, state, draft({ encoding_preset: 'h265_4k', gain: 'low' }), true)).toEqual({ patch: { encoding_preset: 'h265_4k' }, commands: [] })
  })
})
