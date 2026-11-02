import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InspectionTemplate } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { TemplateEditor } from './TemplateEditor'

const items = [
  { label: '機体全般', detail: 'a' },
  { label: 'プロペラ', detail: 'b' },
  { label: 'フレーム', detail: 'c' },
]
const template: InspectionTemplate = { id: 1, name: '様式2 標準', version: 1, items, updated_at: 0 }
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } })
const err = (code: string, status: number) => new Response(JSON.stringify({ success: false, error: { code, message: code } }), { status, headers: { 'content-type': 'application/json' } })

function setup() {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (init?.method === 'PUT') return ok({ ...template, ...(JSON.parse(String(init.body)) as object), version: 2 })
      if (init?.method === 'DELETE') return err('last_template', 409)
      return ok([template])
    }),
  )
  render(<TemplateEditor dict={t('ja')} isAdmin />)
  return { calls }
}

describe('TemplateEditor', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reorders_items_immutably_and_saves_with_positions', async () => {
    const { calls } = setup()
    await waitFor(() => expect(screen.getAllByTestId('template-item')).toHaveLength(3))
    const original = template.items
    const rows = screen.getAllByTestId('template-item')
    fireEvent.click(within(rows[1]).getByRole('button', { name: '上へ' }))
    const after = screen.getAllByTestId('template-item')
    expect(within(after[0]).getByDisplayValue('プロペラ')).toBeInTheDocument()
    expect(within(after[1]).getByDisplayValue('機体全般')).toBeInTheDocument()
    expect(template.items).toBe(original)
    expect(original[0].label).toBe('機体全般')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'PUT')).toBe(true))
    const body = JSON.parse(String(calls.find((c) => c.init?.method === 'PUT')?.init?.body)) as { items: { label: string }[] }
    expect(body.items.map((i) => i.label)).toEqual(['プロペラ', '機体全般', 'フレーム'])
    await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument())
  })

  it('last_template_delete_shows_the_error', async () => {
    setup()
    await waitFor(() => expect(screen.getAllByTestId('template-item')).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'テンプレートを削除' }))
    await waitFor(() => expect(screen.getByText('last_template')).toBeInTheDocument())
  })
})
