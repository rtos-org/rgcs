import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { SurveySlot } from './SurveySlot'

const dict = t('ja')
const base = { dict, error: null, onFinish: vi.fn(), onCancel: vi.fn(), onDismiss: vi.fn(), kmlInput: createRef<HTMLInputElement>(), onKml: vi.fn() }

describe('SurveySlot', () => {
  it('while drawing: the hint, the vertex count, finish only from three vertices', () => {
    render(<SurveySlot {...base} drawing={[{ lat: 36, lon: 139 }, { lat: 36, lon: 139.01 }]} />)
    expect(screen.getByTestId('survey-draw-hint').textContent).toContain(dict.svDrawHint)
    expect(screen.getByText(dict.svDrawCount.replace('{n}', '2'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: dict.svDrawFinish })).toBeDisabled()
  })

  it('a polygon with no lanes is reported even when it came from KML (not drawing), and can be dismissed', () => {
    const onDismiss = vi.fn()
    render(<SurveySlot {...base} onDismiss={onDismiss} drawing={null} error="invalid_polygon" />)
    expect(screen.getByRole('alert').textContent).toContain(dict.svInvalidPolygon)
    fireEvent.click(screen.getByRole('button', { name: dict.close }))
    expect(onDismiss).toHaveBeenCalled()
  })
})
