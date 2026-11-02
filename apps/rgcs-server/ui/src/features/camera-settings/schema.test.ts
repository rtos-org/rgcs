import { describe, expect, it } from 'vitest'
import { cameraProfileSchema, firstIssue, hostFromRtsp } from './schema'

const base = { kind: 'siyi_mt11', host: '192.168.144.25', port: 37260 }

describe('cameraProfileSchema', () => {
  it('requires an IPv4 host and a 1-65535 port', () => {
    expect(cameraProfileSchema.safeParse(base).success).toBe(true)
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, host: 'camera.local' }))).toEqual({ path: 'host', message: expect.any(String) })
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, host: '300.1.1.1' }))?.path).toBe('host')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, port: 0 }))?.path).toBe('port')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, port: 70000 }))?.path).toBe('port')
    expect(cameraProfileSchema.safeParse({ kind: 'none', host: '192.168.144.25', port: 37260 }).success).toBe(true)
    expect(firstIssue(cameraProfileSchema.safeParse(base))).toBeNull()
  })

  it('comp_id is 1-255', () => {
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, comp_id: 0 }))?.path).toBe('comp_id')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...base, comp_id: 256 }))?.path).toBe('comp_id')
    expect(cameraProfileSchema.safeParse({ ...base, comp_id: 154 }).success).toBe(true)
  })

  it('a MAVLink draft needs an RTSP URL whose host is the IPv4 address', () => {
    const mav = { kind: 'mavlink', host: '192.168.144.30', port: 37260, comp_id: 100, rtsp_url: 'rtsp://192.168.144.30:8554/main' }
    expect(firstIssue(cameraProfileSchema.safeParse(mav))).toBeNull()
    expect(firstIssue(cameraProfileSchema.safeParse({ ...mav, rtsp_url: 'rtsp://cam.local/x' }))?.path).toBe('rtsp_url')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...mav, rtsp_url: 'http://192.168.144.30/x' }))?.path).toBe('rtsp_url')
    expect(firstIssue(cameraProfileSchema.safeParse({ ...mav, host: '10.0.0.1' }))?.path).toBe('rtsp_url')
  })
})

describe('hostFromRtsp', () => {
  it('returns an IPv4 literal host or null', () => {
    expect(hostFromRtsp('rtsp://10.0.0.5:554/x')).toBe('10.0.0.5')
    expect(hostFromRtsp('rtsp://192.168.144.30:8554/main')).toBe('192.168.144.30')
    expect(hostFromRtsp('rtsp://cam.local/x')).toBeNull()
    expect(hostFromRtsp('rtsp://user:pw@10.0.0.5/x')).toBeNull()
    expect(hostFromRtsp('http://10.0.0.5/x')).toBeNull()
    expect(hostFromRtsp('not a url')).toBeNull()
  })
})
