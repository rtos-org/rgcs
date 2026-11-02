import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../i18n/lang'
import { LangSwitch } from './LangSwitch'

afterEach(() => {
  cleanup()
  setLang('ja')
})

describe('LangSwitch', () => {
  it('offers every language under its own name and marks the current one', () => {
    render(<LangSwitch variant="seg" />)
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['English', '日本語', '简体中文', '한국어'])
    expect(screen.getByRole('button', { name: '日本語' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches and remembers the pick', () => {
    render(<LangSwitch variant="login" />)
    fireEvent.click(screen.getByRole('button', { name: '한국어' }))
    expect(screen.getByRole('button', { name: '한국어' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('rgcs.lang')).toBe('ko')
  })
})
