import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import type { VehicleState } from '../../shared/api/types'
import { battLow, battText, battWidth, dotClass, matches, modeLabel } from './format'

const dict = t('ja')
const v: VehicleState = {
  sysid: 5,
  name: 'UAV-05',
  kind: 'rover',
  mode: '',
  armed: false,
  lat: 0,
  lon: 0,
  alt_rel: 0,
  alt_msl: 0,
  hdg: null,
  ground_speed: 0,
  climb: 0,
  battery: { pct: null, volt: 12.6, current: null },
  link: 'ok',
  last_rx_ms: 0,
  gps: { fix: 0, sats: 0, hdop: null },
  warn: false,
  unread: 0,
}

describe('vehicle formatting', () => {
  it('shows the ground label before the first heartbeat and the mode afterwards', () => {
    expect(modeLabel(v, dict)).toBe('地表')
    expect(modeLabel({ ...v, mode: 'HOLD' }, dict)).toBe('HOLD')
  })

  it('falls back to voltage when the percentage is unknown', () => {
    expect(battText(v)).toBe('12.6 V')
    expect(battText({ ...v, battery: { pct: 46, volt: 21, current: null } })).toBe('46%')
    expect(battLow({ ...v, battery: { pct: 46, volt: 21, current: null } })).toBe(true)
    expect(battLow(v)).toBe(false)
  })

  it('shows a dash, not 0.0 V, for a vehicle without a battery monitor', () => {
    expect(battText({ ...v, battery: { pct: null, volt: 0, current: null } })).toBe('—')
  })

  it('an unknown percentage draws an empty bar, never a full one', () => {
    expect(battWidth({ ...v, battery: { pct: null, volt: 12.6, current: null } })).toBe('0%')
    expect(battWidth({ ...v, battery: { pct: 64, volt: 22, current: null } })).toBe('64%')
  })

  it('the status dot means link / health only, never the airframe', () => {
    expect(dotClass({ ...v, kind: 'copter' })).toBe('dot ok')
    expect(dotClass({ ...v, kind: 'rover' })).toBe('dot ok')
    expect(dotClass({ ...v, link: 'delay' })).toBe('dot warn')
    expect(dotClass({ ...v, link: 'lost' })).toBe('dot lost')
  })

  it('filters by name or mode, ignoring case', () => {
    expect(matches(v, 'uav-05', dict)).toBe(true)
    expect(matches({ ...v, mode: 'AUTO' }, 'auto', dict)).toBe(true)
    expect(matches(v, 'rtl', dict)).toBe(false)
    expect(matches(v, '  ', dict)).toBe(true)
  })
})
