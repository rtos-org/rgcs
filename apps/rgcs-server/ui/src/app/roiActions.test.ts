import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ startRoi: vi.fn(), stopRoi: vi.fn() }))
vi.mock('../features/roi/api', () => api)
const { vehicleStore } = await import('../features/vehicles/store')
const { runButtonAction, roiStart, roiStop } = await import('./roiActions')

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('ROI actions (cockpit chips, joystick)', () => {
  beforeEach(() => {
    api.startRoi.mockReset()
    api.stopRoi.mockReset()
  })

  it('routes a joystick action to the camera or the ROI API', () => {
    api.startRoi.mockResolvedValue(undefined)
    api.stopRoi.mockResolvedValue({ stopped: true })
    const camera = vi.fn()
    runButtonAction(2, { kind: 'camera', cmd: { cmd: 'photo' } }, camera)
    runButtonAction(2, { kind: 'roi_start', id: 'roi_4' }, camera)
    runButtonAction(2, { kind: 'roi_stop' }, camera)
    runButtonAction(2, null, camera)
    expect(camera.mock.calls).toEqual([[2, { cmd: 'photo' }]])
    expect(api.startRoi).toHaveBeenCalledWith(2, 'roi_4')
    expect(api.stopRoi).toHaveBeenCalledWith(2)
  })

  it('reports a failed start or stop in the footer results', async () => {
    const push = vi.spyOn(vehicleStore, 'pushLocalResult')
    api.startRoi.mockRejectedValue(new Error('roi_target_unset'))
    api.stopRoi.mockRejectedValue(new Error('boom'))
    roiStart(3, 'roi_1')
    roiStop(3)
    await flush()
    expect(push.mock.calls.map(([r]) => [r.sysid, r.cmd, r.ok, r.reason])).toEqual([
      [3, 'roi_start', false, 'roi_target_unset'],
      [3, 'roi_stop', false, 'boom'],
    ])
  })
})
