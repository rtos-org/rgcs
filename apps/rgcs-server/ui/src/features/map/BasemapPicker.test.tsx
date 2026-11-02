import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Basemap } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { BasemapPicker } from './BasemapPicker'
import { overlayFetch } from '../overlays/testData'

const list: Basemap[] = [
  { id: 'map', label: '地図', tiles: ['a'], attribution: '', max_zoom: 19, overlay: null },
  { id: 'satellite', label: '衛星写真', tiles: ['b'], attribution: '', max_zoom: 19, overlay: null },
]

describe('BasemapPicker', () => {
  it('picker_switches_the_base_tiles', () => {
    const onPick = vi.fn()
    render(<BasemapPicker basemaps={list} current="map" dict={t('ja')} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: 'マップタイプ' }))
    expect(screen.getByRole('menuitemradio', { name: '地図' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '衛星写真' }))
    expect(onPick).toHaveBeenCalledWith('satellite')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and on a press outside', () => {
    render(
      <div>
        <span>outside</span>
        <BasemapPicker basemaps={list} current="map" dict={t('ja')} onPick={() => {}} />
      </div>,
    )
    const toggle = screen.getByRole('button', { name: 'マップタイプ' })
    fireEvent.click(toggle)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.pointerDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('lists_no_base_choice_when_there_is_only_one_map', async () => {
    vi.stubGlobal('fetch', vi.fn(overlayFetch()))
    render(<BasemapPicker basemaps={list.slice(0, 1)} current="map" dict={t('ja')} onPick={() => {}} overlays="ops" />)
    fireEvent.click(screen.getByRole('button', { name: 'マップタイプ' }))
    expect(screen.queryByRole('menuitemradio')).toBeNull()
    expect(await screen.findByRole('menuitemcheckbox', { name: 'LTE エリア' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('carries_the_plugin_overlay_section_and_opens_an_area_sheet', async () => {
    vi.stubGlobal('fetch', vi.fn(overlayFetch()))
    render(<BasemapPicker basemaps={list} current="map" dict={t('ja')} onPick={() => {}} overlays="plan" />)
    fireEvent.click(screen.getByRole('button', { name: 'マップタイプ' }))
    expect(await screen.findByRole('group', { name: 'オーバーレイ' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'LTE エリア: 範囲を管理…' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'LTE エリア' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('has_no_overlay_section_without_a_map_key', () => {
    render(<BasemapPicker basemaps={list} current="map" dict={t('ja')} onPick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'マップタイプ' }))
    expect(screen.queryByRole('group', { name: 'オーバーレイ' })).toBeNull()
  })
})
