import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { MapFinder } from './MapFinder'

const dict = t('ja')
const vehicles = [
  { sysid: 1, name: 'UAV-01', lat: 36.25, lon: 137.63 },
  { sysid: 2, name: 'UAV-02', lat: 35.01, lon: 138.53 },
]

describe('MapFinder', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a typed "lat, lon" goes straight there without a lookup', () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const onGo = vi.fn()
    render(<MapFinder vehicles={vehicles} dict={dict} onGo={onGo} />)
    fireEvent.click(screen.getByRole('button', { name: '場所を検索' }))
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: '35.0145, 138.5302' } })
    fireEvent.submit(input)
    expect(onGo).toHaveBeenCalledWith({ lat: 35.0145, lon: 138.5302 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a place name lists the hits and picking one goes there', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify([{ lat: '35.0145', lon: '138.5302', name: '三保飛行場', display_name: '三保飛行場, 静岡市' }]))))
    const onGo = vi.fn()
    render(<MapFinder vehicles={vehicles} dict={dict} onGo={onGo} />)
    fireEvent.click(screen.getByRole('button', { name: '場所を検索' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '三保飛行場' } })
    await act(async () => {
      fireEvent.submit(screen.getByRole('searchbox'))
    })
    fireEvent.click(screen.getByRole('button', { name: /三保飛行場, 静岡市/ }))
    expect(onGo).toHaveBeenCalledWith({ lat: 35.0145, lon: 138.5302 })
  })

  it('a newer search wins over a slower earlier one', async () => {
    const answers: ((r: Response) => void)[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_u, init) => new Promise<Response>((resolve, reject) => {
      answers.push(resolve)
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    render(<MapFinder vehicles={vehicles} dict={dict} onGo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '場所を検索' }))
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: '東京' } })
    fireEvent.submit(box)
    fireEvent.change(box, { target: { value: '大阪' } })
    fireEvent.submit(box)
    await act(async () => {
      answers[1]!(new Response(JSON.stringify([{ lat: '34.7', lon: '135.5', name: '大阪', display_name: '大阪, 日本' }])))
      answers[0]!(new Response(JSON.stringify([{ lat: '35.6', lon: '139.7', name: '東京', display_name: '東京, 日本' }])))
    })
    expect(screen.getByRole('button', { name: '大阪, 日本' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '東京, 日本' })).not.toBeInTheDocument()
  })

  it('nothing found says so', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response('[]')))
    render(<MapFinder vehicles={vehicles} dict={dict} onGo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '場所を検索' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } })
    await act(async () => {
      fireEvent.submit(screen.getByRole('searchbox'))
    })
    expect(screen.getByText('見つかりませんでした')).toBeInTheDocument()
  })

  it('the vehicle button lists the vehicles; one vehicle is flown to at once', () => {
    const onGo = vi.fn()
    const { rerender } = render(<MapFinder vehicles={vehicles} dict={dict} onGo={onGo} />)
    fireEvent.click(screen.getByRole('button', { name: '機体の位置へ' }))
    fireEvent.click(screen.getByRole('button', { name: 'UAV-02' }))
    expect(onGo).toHaveBeenLastCalledWith({ lat: 35.01, lon: 138.53 })
    rerender(<MapFinder vehicles={vehicles.slice(0, 1)} dict={dict} onGo={onGo} />)
    fireEvent.click(screen.getByRole('button', { name: '機体の位置へ' }))
    expect(onGo).toHaveBeenLastCalledWith({ lat: 36.25, lon: 137.63 })
  })
})
