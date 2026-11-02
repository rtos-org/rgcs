import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dictionaries } from '../../shared/i18n'
import { CarrierLinks } from './CarrierLinks'
import { registerMap } from './mapRegistry'

const dict = dictionaries.ja
const view = { getSouth: () => 33.6, getWest: () => 135.8, getNorth: () => 33.7, getEast: () => 136.0 }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CarrierLinks', () => {
  it('opens each carrier official coverage map in a new tab', () => {
    render(<CarrierLinks dict={dict} mapKey="plan" />)
    const links = screen.getAllByRole('menuitem').filter((el) => el.tagName === 'A')
    expect(links.map((a) => a.textContent)).toEqual(['ドコモ', 'au', 'ソフトバンク', '楽天モバイル'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.docomo.ne.jp/area/map/',
      'https://www.au.com/mobile/area/map/',
      'https://www.softbank.jp/mobile/network/area-map/',
      'https://network.mobile.rakuten.co.jp/area/',
    ])
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('copies the map centre so it can be searched on the carrier map', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const off = registerMap('plan', () => view)
    render(<CarrierLinks dict={dict} mapKey="plan" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '地図の中心の緯度経度をコピー' }))
    })
    expect(writeText).toHaveBeenCalledWith('33.650000, 135.900000')
    expect(screen.getByRole('menuitem', { name: 'コピーしました' })).toBeInTheDocument()
    off()
  })
})
