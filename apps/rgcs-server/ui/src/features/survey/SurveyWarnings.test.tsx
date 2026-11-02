import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { t } from '../../shared/i18n'
import { generateSurvey, surveyNumbers } from './generate'
import { fmtNum } from './NumField'
import { HOME, fixtureSpec } from './surveyFixture'
import { SurveyNumbers } from './SurveyNumbers'
import { SurveyWarnings } from './SurveyWarnings'
import type { SurveyMetrics } from './useSurvey'
import type { SurveyWarning } from './warnings'
import type { WorstCase } from './worst'

const dict = t('ja')

function metrics(warnings: SurveyWarning[], worst: WorstCase | null): SurveyMetrics {
  const spec = fixtureSpec()
  const gen = generateSurvey(spec, HOME)
  if ('error' in gen) throw new Error(gen.error)
  const ground = worst ? { min: 100, max: 180 } : null
  return { spec, items: gen.items, geometry: gen.geometry, numbers: surveyNumbers(spec, gen.geometry, gen.items), ground, worst, warnings, vehicle: {} }
}

describe('survey warnings copy (I5)', () => {
  it('terrain: the ground within N m under the flight altitude, or N m above it', () => {
    const near: WorstCase = { gsdCm: 1, minGsdCm: 0.2, frontPct: 60, sidePct: 50, lowAglM: 12.4 }
    const { unmount } = render(<SurveyWarnings spec={fixtureSpec()} metrics={metrics(['terrain'], near)} dict={dict} />)
    expect(screen.getByText(dict.svWarnTerrain.replace('{n}', '12').replace('{min}', '30'))).toBeInTheDocument()
    unmount()
    render(<SurveyWarnings spec={fixtureSpec()} metrics={metrics(['terrain'], { ...near, lowAglM: -20 })} dict={dict} />)
    expect(screen.getByText(dict.svWarnTerrainAbove.replace('{n}', '20'))).toBeInTheDocument()
  })

  it('a number that is not finite reads — rather than blank', () => {
    expect(fmtNum(Infinity, 1)).toBe('—')
    expect(fmtNum(Number.NaN, 0)).toBe('—')
    const worst: WorstCase = { gsdCm: Infinity, minGsdCm: 0, frontPct: -100, sidePct: -100, lowAglM: -20 }
    render(<SurveyNumbers spec={fixtureSpec()} metrics={metrics(['terrain'], worst)} dict={dict} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
