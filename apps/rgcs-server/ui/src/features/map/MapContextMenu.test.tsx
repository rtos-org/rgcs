import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { MapContextMenu } from './MapContextMenu'

const at = { lat: 35.489883, lon: 138.48829, x: 300, y: 200 }

describe('MapContextMenu', () => {
  it('offers Guided to the point for the selected vehicle', () => {
    const onGuided = vi.fn()
    const onClose = vi.fn()
    render(<MapContextMenu at={at} vehicleName="UAV-01" dict={t('ja')} onGuided={onGuided} onClose={onClose} />)
    const item = screen.getByRole('menuitem', { name: /ここへ Guided 移動/ })
    expect(screen.getByRole('menu')).toHaveTextContent('UAV-01')
    fireEvent.click(item)
    expect(onGuided).toHaveBeenCalledWith({ lat: 35.489883, lon: 138.48829 })
    expect(onClose).toHaveBeenCalled()
  })
  it('is disabled without a vehicle', () => {
    render(<MapContextMenu at={at} vehicleName={null} dict={t('ja')} onGuided={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('menuitem', { name: /ここへ Guided 移動/ })).toBeDisabled()
  })
  it('escape and a click elsewhere close it', () => {
    const onClose = vi.fn()
    render(<MapContextMenu at={at} vehicleName="UAV-01" dict={t('ja')} onGuided={() => {}} onClose={onClose} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
