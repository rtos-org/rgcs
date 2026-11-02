import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../shared/i18n'
import { UserPopover } from './UserPopover'

const me = { username: 'admin', role: 'admin' as const, dev_mode: true, hostname: 'rgcs' }

describe('UserPopover', () => {
  it('shows the user, role, audit note and a logout button', () => {
    const onLogout = vi.fn()
    render(<UserPopover me={me} onLogout={onLogout} onClose={() => {}} dict={t('ja')} />)
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('管理者')).toBeInTheDocument()
    expect(screen.getByText('操作履歴にはこの名前で記録されます')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<UserPopover me={{ ...me, role: 'operator' }} onLogout={() => {}} onClose={onClose} dict={t('ja')} />)
    expect(screen.getByText('オペレータ')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
