import { fireEvent, render } from '@testing-library/react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { clientSession, mavLink, netComponent, netVehicle, topology } from './fixture'
import { toGraph } from './graph'
import { layoutNetwork } from './layout'
import { NetworkCanvas } from './NetworkCanvas'
import { fitView } from './viewport'

const dict = t('ja')
const graph = toGraph(
  topology(1, {
    links: [mavLink()],
    vehicles: [netVehicle(1, { components: [netComponent(1, 'autopilot'), netComponent(100, 'camera')] }), netVehicle(2)],
    clients: [clientSession(1), clientSession(2)],
  }),
)
const onSelect = vi.fn<(id: string) => void>()

const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
})
afterAll(() => {
  if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc)
  if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDesc)
})
beforeEach(() => {
  onSelect.mockReset()
})

const draw = (selected = 'server') => render(<NetworkCanvas graph={graph} selected={selected} onSelect={onSelect} dict={dict} />)
const fitPct = () => {
  const l = layoutNetwork(graph)
  return Math.round(fitView(1000, 600, l.W, l.H).k * 100)
}

describe('NetworkCanvas', () => {
  it('draws the vehicle block with its name, SYSID and components', () => {
    const { container } = draw()
    const v = container.querySelector('g.nn[data-id="v:1"]')
    expect(v?.textContent).toContain('UAV-01')
    expect(v?.textContent).toContain('SYSID 1')
    expect(v?.textContent).toContain('FC · AP 1 · CAM 100')
    expect(container.querySelector('g.nn[data-id="server"]')?.textContent).toContain('rgcs-server')
    expect(container.querySelector('g.npl[data-id="link:link0"]')?.textContent).toContain('tcp:127.0.0.1:5760')
    expect(container.querySelector('g.nn[data-id="c:2"]')).not.toBeNull()
  })

  it('draws the unconfigured Hub as a placeholder', () => {
    const { container } = draw()
    expect(container.querySelector('g.nn.ph[data-id="ph:hub"]')?.textContent).toContain('未構成')
    expect(container.querySelector('g.npl.ph[data-id="ph:lte:1"]')).not.toBeNull()
  })

  it('selects what is clicked, and the server on empty canvas', () => {
    const { container } = draw()
    fireEvent.click(container.querySelector('g[data-id="v:1"] rect') as Element)
    expect(onSelect).toHaveBeenLastCalledWith('v:1')
    fireEvent.click(container.querySelector('svg.netsvg') as Element)
    expect(onSelect).toHaveBeenLastCalledWith('server')
  })

  it('does not treat a drag as a click', () => {
    const { container } = draw()
    const map = container.querySelector('.netmap') as Element
    const target = container.querySelector('g[data-id="v:1"] rect') as Element
    const tx = () => Number(/translate\(([-\d.e]+),/.exec(map.querySelector('g.vp')?.getAttribute('transform') ?? '')?.[1])
    const before = tx()
    fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 110, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 110, clientY: 100 })
    fireEvent.click(target)
    expect(onSelect).not.toHaveBeenCalled()
    expect(tx() - before).toBeCloseTo(10)
    fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 102, clientY: 101 })
    fireEvent.pointerUp(window, { clientX: 102, clientY: 101 })
    fireEvent.click(target)
    expect(onSelect).toHaveBeenLastCalledWith('v:1')
  })

  it('dims what is not related to the selection', () => {
    const { container } = draw('v:1')
    expect(container.querySelector('g[data-id="v:2"]')?.classList.contains('dim')).toBe(true)
    expect(container.querySelector('g[data-id="server"]')?.classList.contains('dim')).toBe(false)
    expect(container.querySelector('g[data-id="v:1"]')?.classList.contains('sel')).toBe(true)
  })

  it('zooms in with the + button by 1.25', () => {
    const { container, getByTitle } = draw()
    const z = container.querySelector('.netctl .z') as Element
    const fit = fitPct()
    expect(z.textContent).toBe(`${fit}%`)
    const l = layoutNetwork(graph)
    const k = fitView(1000, 600, l.W, l.H).k
    fireEvent.click(getByTitle(dict.netZoomIn))
    expect(z.textContent).toBe(`${Math.round(k * 1.25 * 100)}%`)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(getByTitle(dict.netFit))
    expect(z.textContent).toBe(`${fit}%`)
  })

  it('zooms in on ctrl+wheel', () => {
    const { container } = draw()
    const z = container.querySelector('.netctl .z') as Element
    const before = parseInt(z.textContent ?? '0', 10)
    fireEvent.wheel(container.querySelector('.netmap') as Element, { ctrlKey: true, deltaY: -100 })
    expect(parseInt(z.textContent ?? '0', 10)).toBeGreaterThan(before)
  })

  it('drops detail when zoomed out: compact cards, then site tiles under a summary card', () => {
    const { container, getByTitle } = draw()
    const out = () => fireEvent.click(getByTitle(dict.netZoomOut))
    while (parseInt(container.querySelector('.netctl .z')?.textContent ?? '0', 10) >= 55) out()
    expect(container.querySelector('g[data-id="v:1"]')?.textContent).toBe('UAV-01')
    expect(container.querySelector('circle.mdot')?.getAttribute('r')).toBe('9')
    while (parseInt(container.querySelector('.netctl .z')?.textContent ?? '0', 10) >= 28) out()
    expect(container.querySelector('g[data-id="r:1"]')).toBeNull()
    const site = container.querySelector('g[data-id="site:A"] rect') as Element
    expect(site).not.toBeNull()
    fireEvent.click(site)
    expect(onSelect).toHaveBeenLastCalledWith('server')
  })
})
