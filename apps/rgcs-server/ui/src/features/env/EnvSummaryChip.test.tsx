import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EnvFactor, EnvReading, EnvSummary } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { EnvSummaryChip } from './EnvSummaryChip'

const dict = t('ja')
// 2026-10-26 12:34:56 JST
const AT = Date.UTC(2026, 9, 26, 3, 34, 56)

function reading(over: Partial<EnvReading> = {}): EnvReading {
  return { source: 'swpc_kp', class: 'observed', value: 7.3, at_ms: AT, fresh: true, note: null, ...over }
}

function factor(over: Partial<EnvFactor> = {}): EnvFactor {
  const r = reading()
  return { kind: 'kp', level: 'strong', unit: '', value: r, primary: r, readings: [r], disagree: false, ...over }
}

function summary(over: Partial<EnvSummary> = {}): EnvSummary {
  const wind = reading({ source: 'open_meteo', class: 'forecast', value: 4.2 })
  return {
    cell: [36.25, 137.64],
    factors: [factor({ kind: 'wind', level: 'ok', unit: 'm/s', value: wind, primary: wind, readings: [wind] }), factor()],
    missing: [],
    unavailable: false,
    notes: [],
    ts: AT,
    ...over,
  }
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /外的要因/ }))
  return screen.getByRole('dialog')
}

describe('EnvSummaryChip', () => {
  it('shows a dash before any summary', () => {
    render(<EnvSummaryChip summary={null} dict={dict} now={AT} />)
    expect(screen.getByRole('button')).toHaveTextContent('外的要因: —')
  })

  it('shows 取得できず with the last time when every source is out', () => {
    render(<EnvSummaryChip summary={summary({ unavailable: true })} dict={dict} now={AT} />)
    const chip = screen.getByRole('button')
    expect(chip).toHaveTextContent('外的要因: 取得できず')
    expect(chip).toHaveTextContent('12:34:56')
  })

  it('takes the worst factor for the chip', () => {
    render(<EnvSummaryChip summary={summary()} dict={dict} now={AT} />)
    const chip = screen.getByRole('button')
    expect(chip).toHaveClass('strong')
    expect(chip).toHaveTextContent('Kp 7.3')
  })

  it('lists every factor with value, source and JST time', () => {
    render(<EnvSummaryChip summary={summary()} dict={dict} now={AT} />)
    const pop = open()
    const kp = within(pop).getByTestId('env-factor-kp')
    expect(kp).toHaveTextContent('7.3')
    expect(kp).toHaveTextContent('NOAA SWPC Kp')
    expect(kp).toHaveTextContent('12:34:56')
    expect(within(pop).getByTestId('env-factor-wind')).toHaveTextContent('4.2 m/s')
  })

  it('greys stale readings', () => {
    const stale = reading({ fresh: false, value: 3 })
    render(<EnvSummaryChip summary={summary({ factors: [factor({ readings: [reading(), stale] })] })} dict={dict} now={AT} />)
    const pop = open()
    expect(pop.querySelectorAll('.env-reading.stale')).toHaveLength(1)
  })

  it('flags disagreeing sources with each value', () => {
    const a = reading({ source: 'open_meteo', class: 'forecast', value: 4 })
    const b = reading({ source: 'jma_amedas', class: 'observed', value: 9 })
    const wind = factor({ kind: 'wind', level: 'warn', unit: 'm/s', value: b, primary: b, readings: [b, a], disagree: true })
    render(<EnvSummaryChip summary={summary({ factors: [wind] })} dict={dict} now={AT} />)
    const pop = open()
    const row = within(pop).getByTestId('env-factor-wind')
    expect(row).toHaveTextContent('取得元で値が割れています')
    expect(row).toHaveTextContent('Open-Meteo')
    expect(row).toHaveTextContent('気象庁 アメダス')
    expect(row).toHaveTextContent('4.0 m/s')
    expect(row).toHaveTextContent('9.0 m/s')
  })

  it('renders SWPC notes as plain text', () => {
    render(<EnvSummaryChip summary={summary({ notes: ['ALTK07 2026-10-26T03:00Z — <b>storm</b>'] })} dict={dict} now={AT} />)
    const pop = open()
    expect(pop.querySelector('b')).toBeNull()
    expect(pop).toHaveTextContent('<b>storm</b>')
  })

  it('closes on Escape', () => {
    render(<EnvSummaryChip summary={summary()} dict={dict} now={AT} />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
