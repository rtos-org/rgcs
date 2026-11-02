import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { WpGoPopover } from './WpGoPopover'
import { popoverPlacement, wpGoCommand } from './wpGo'

const vehicle = (mode: string, link: VehicleState['link'] = 'ok'): VehicleState => ({
  sysid: 3, name: 'UAV-03', kind: 'copter', mode, armed: true, lat: 35.479883, lon: 138.47829, alt_rel: 50, alt_msl: 0, hdg: 10,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link, last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
})
const at = { sysid: 3, n: 5, x: 300, y: 200 }

describe('wpGoCommand', () => {
  it('is MAV_CMD_DO_SET_MISSION_CURRENT with the mission seq in param1', () => {
    expect(wpGoCommand(5)).toEqual({ cmd: 'other', args: { mav_cmd: 224, params: [5, 0, 0, 0, 0, 0, 0] } })
  })
})

afterEach(() => vi.restoreAllMocks())

describe('WpGoPopover', () => {
  it('names the waypoint and the vehicle; 送信 sends the set-current command for that vehicle and closes', () => {
    const onSend = vi.fn()
    const onClose = vi.fn()
    render(<WpGoPopover at={at} vehicle={vehicle('AUTO')} dict={t('ja')} onSend={onSend} onClose={onClose} />)
    const box = screen.getByRole('dialog')
    expect(box).toHaveTextContent('WP 5 へ行く')
    expect(box).toHaveTextContent('UAV-03')
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(onSend).toHaveBeenCalledWith(3, { cmd: 'other', args: { mav_cmd: 224, params: [5, 0, 0, 0, 0, 0, 0] } })
    expect(onClose).toHaveBeenCalled()
  })
  it('キャンセル, Escape and a click elsewhere close without sending', () => {
    const onSend = vi.fn()
    const onClose = vi.fn()
    render(<WpGoPopover at={at} vehicle={vehicle('AUTO')} dict={t('ja')} onSend={onSend} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onSend).not.toHaveBeenCalled()
  })
  it('a click inside does not close it', () => {
    const onClose = vi.fn()
    render(<WpGoPopover at={at} vehicle={vehicle('AUTO')} dict={t('ja')} onSend={() => {}} onClose={onClose} />)
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('shows the AUTO hint only when the vehicle is not in AUTO', () => {
    const hint = 'AUTO 以外では、次に AUTO にしたときこの WP から進みます'
    const { rerender } = render(<WpGoPopover at={at} vehicle={vehicle('AUTO')} dict={t('ja')} onSend={() => {}} onClose={() => {}} />)
    expect(screen.queryByText(hint)).toBeNull()
    rerender(<WpGoPopover at={at} vehicle={vehicle('LOITER')} dict={t('ja')} onSend={() => {}} onClose={() => {}} />)
    expect(screen.getByText(hint)).toBeInTheDocument()
  })
  it('disables 送信 while the link is lost or the vehicle is gone', () => {
    const { rerender } = render(<WpGoPopover at={at} vehicle={vehicle('AUTO', 'lost')} dict={t('ja')} onSend={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled()
    rerender(<WpGoPopover at={at} vehicle={undefined} dict={t('ja')} onSend={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled()
  })
  it('has English copy', () => {
    render(<WpGoPopover at={at} vehicle={vehicle('GUIDED')} dict={t('en')} onSend={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Go to WP 5')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('stays inside the viewport near its edges so 送信 remains reachable', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 220, height: 120 } as DOMRect)
    const vw = window.innerWidth
    const vh = window.innerHeight
    render(<WpGoPopover at={{ ...at, x: vw - 5, y: vh - 5 }} vehicle={vehicle('AUTO')} dict={t('ja')} onSend={() => {}} onClose={() => {}} />)
    const box = screen.getByRole('dialog')
    expect(parseFloat(box.style.left)).toBe(vw - 220 - 8)
    expect(parseFloat(box.style.top)).toBe(vh - 5 - 10 - 120)
  })
})

describe('popoverPlacement', () => {
  const size = { w: 200, h: 100 }
  const view = { w: 1000, h: 800 }
  it('centres the box under the anchor', () => {
    expect(popoverPlacement({ x: 500, y: 300 }, size, view)).toEqual({ left: 400, top: 310 })
  })
  it('clamps to the left and right edges', () => {
    expect(popoverPlacement({ x: 10, y: 300 }, size, view).left).toBe(8)
    expect(popoverPlacement({ x: 995, y: 300 }, size, view).left).toBe(792)
  })
  it('opens above the anchor when there is no room below, never off the top', () => {
    expect(popoverPlacement({ x: 500, y: 750 }, size, view).top).toBe(640)
    expect(popoverPlacement({ x: 500, y: 50 }, { w: 200, h: 900 }, view).top).toBe(8)
  })
})
