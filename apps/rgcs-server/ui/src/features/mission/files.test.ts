import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { parseRgcsMission, serializeRgcsMission } from './files'

const mission: Mission = {
  id: 3,
  name: 'm',
  sysid: 1,
  default_alt: 50,
  default_frame: 'rel',
  speed: 8,
  home: { lat: 35.481883, lon: 138.48029, alt: 0 },
  items: [{ command: 22, frame: 'rel', params: [0, 0, 0, 0], lat: 35.481883, lon: 138.48029, alt: 30, autocontinue: true }],
  fence: [
    { kind: 'circle', inclusion: true, center: { lat: 35.481883, lon: 138.48029 }, radius: 300 },
    { kind: 'polygon', inclusion: false, vertices: [{ lat: 35.479883, lon: 138.47829 }, { lat: 35.479883, lon: 138.48829 }, { lat: 35.489883, lon: 138.48829 }] },
  ],
  rally: [{ lat: 35.482883, lon: 138.48129, alt: 60 }],
  surveys: [],
}

describe('.rgcsmission files', () => {
  it('rgcsmission_reads_a_v1_file_without_surveys', () => {
    const old = JSON.parse(serializeRgcsMission(mission))
    delete old.mission.surveys
    expect(old.version).toBe(1)
    expect(parseRgcsMission(JSON.stringify(old)).surveys).toEqual([])
    const huge = JSON.parse(serializeRgcsMission({ ...mission, surveys: [{ id: 'h', first: 0, count: 5e9, spec: {} }] }))
    expect(() => parseRgcsMission(JSON.stringify(huge))).toThrow()
  })

  it('rgcsmission_round_trips_and_rejects_bad_json', () => {
    const text = serializeRgcsMission(mission)
    expect(text).toContain('"format": "rgcsmission"')
    const back = parseRgcsMission(text)
    expect(back).toEqual({ ...mission, id: null })
    expect(() => parseRgcsMission('{"nope":1}')).toThrow()
    expect(() => parseRgcsMission('not json')).toThrow()
    expect(() => parseRgcsMission(JSON.stringify({ format: 'rgcsmission', mission: { ...mission, items: [{ command: 'x' }] } }))).toThrow()
  })

  it('rgcsmission_keeps_the_fence_and_rally_and_reads_older_files_without_them', () => {
    expect(parseRgcsMission(serializeRgcsMission(mission))).toEqual({ ...mission, id: null })
    const old = JSON.parse(serializeRgcsMission(mission))
    delete old.mission.fence
    delete old.mission.rally
    const read = parseRgcsMission(JSON.stringify(old))
    expect([read.fence, read.rally]).toEqual([[], []])
    const bad = JSON.parse(serializeRgcsMission(mission))
    bad.mission.fence[0].radius = 'x'
    expect(() => parseRgcsMission(JSON.stringify(bad))).toThrow()
  })
})
