import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkTopology } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { clientSession, mavLink, netVehicle, topology } from './fixture'

const fetchNetwork = vi.fn<() => Promise<NetworkTopology>>()
vi.mock('./api', () => ({ fetchNetwork: () => fetchNetwork() }))

const { NetworkView } = await import('./NetworkView')
const dict = t('ja')
const topo = (at: number, o: Partial<NetworkTopology> = {}) =>
  topology(at, { links: [mavLink()], vehicles: [netVehicle(1), netVehicle(2)], clients: [clientSession(1), clientSession(2), clientSession(3)], ...o })
const panelTitle = (c: HTMLElement) => c.querySelector('aside.panel .panel-h .h1')?.textContent

describe('NetworkView', () => {
  beforeEach(() => {
    fetchNetwork.mockReset()
    fetchNetwork.mockReturnValue(new Promise(() => {}))
  })

  it('renders the title bar, the summary, the legend and the server panel', () => {
    const { container } = render(<NetworkView ws={topo(1)} dict={dict} />)
    expect(container.querySelector('.netbar .h1')?.textContent).toBe('ネットワーク')
    expect(screen.getByText('1 リンク · 2 機体 · 0 警告 · 3 クライアント')).toBeTruthy()
    expect(container.querySelectorAll('.netbar .lg')).toHaveLength(4)
    expect(panelTitle(container)).toBe('rgcs-server')
  })

  it('shows the clicked element in the panel', () => {
    const { container } = render(<NetworkView ws={topo(1)} dict={dict} />)
    const v1 = container.querySelector('g[data-id="v:1"]')
    if (v1 === null) throw new Error('no vehicle block')
    fireEvent.click(v1)
    expect(panelTitle(container)).toBe('UAV-01')
  })

  it('keeps the selection across refreshes and falls back to the server when it disappears', () => {
    const { container, rerender } = render(<NetworkView ws={topo(1)} dict={dict} />)
    const c3 = container.querySelector('g[data-id="c:3"]')
    if (c3 === null) throw new Error('no client card')
    fireEvent.click(c3)
    expect(panelTitle(container)).toBe('admin')
    rerender(<NetworkView ws={topo(2)} dict={dict} />)
    expect(panelTitle(container)).toBe('admin')
    rerender(<NetworkView ws={topo(3, { clients: [clientSession(1)] })} dict={dict} />)
    expect(panelTitle(container)).toBe('rgcs-server')
  })

  it('says it is loading before any topology', () => {
    render(<NetworkView ws={null} dict={dict} />)
    expect(screen.getByText('ネットワーク情報を取得中')).toBeTruthy()
  })

  it('says it failed when the GET fails and nothing arrived', async () => {
    fetchNetwork.mockReset()
    fetchNetwork.mockRejectedValue(new Error('500'))
    render(<NetworkView ws={null} dict={dict} />)
    await waitFor(() => expect(screen.getByText('ネットワーク情報を取得できません')).toBeTruthy())
  })
})
