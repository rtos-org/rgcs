import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { SURVEY_KEY, SURVEY_KML_KEY } from './cmds'
import { CommandPalette } from './CommandPalette'

const dict = t('ja')

describe('CommandPalette survey entries', () => {
  it('offers サーベイ and KML から読み込む as pseudo keys', () => {
    const onInsert = vi.fn()
    render(<CommandPalette where="" dict={dict} onInsert={onInsert} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^サーベイ/ }))
    fireEvent.click(screen.getByRole('button', { name: /KML から読み込む/ }))
    expect(onInsert.mock.calls).toEqual([[SURVEY_KEY], [SURVEY_KML_KEY]])
  })
})
