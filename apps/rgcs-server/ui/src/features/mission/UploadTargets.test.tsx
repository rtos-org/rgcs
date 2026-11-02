import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { UploadTargets } from './UploadTargets'

const dict = t('ja')
const vehicles = [
  { sysid: 1, name: 'UAV-01' },
  { sysid: 2, name: 'UAV-02' },
  { sysid: 3, name: 'UAV-03' },
]

describe('UploadTargets', () => {
  it('starts with the mission target ticked; all / none and single toggles pick the vehicles to write', () => {
    const onWrite = vi.fn()
    render(<UploadTargets vehicles={vehicles} target={2} dict={dict} onWrite={onWrite} onClose={vi.fn()} />)
    const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(name) }) as HTMLInputElement
    expect([box('UAV-01').checked, box('UAV-02').checked, box('UAV-03').checked]).toEqual([false, true, false])
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByRole('button', { name: '3 機に書き込む' })).toBeEnabled()
    fireEvent.click(box('UAV-02'))
    fireEvent.click(screen.getByRole('button', { name: '2 機に書き込む' }))
    expect(onWrite).toHaveBeenCalledWith([1, 3])
  })

  it('cannot write with nothing ticked', () => {
    render(<UploadTargets vehicles={vehicles} target={1} dict={dict} onWrite={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'すべて解除' }))
    expect(screen.getByRole('button', { name: '0 機に書き込む' })).toBeDisabled()
  })
})
