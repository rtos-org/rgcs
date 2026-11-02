import { describe, expect, it } from 'vitest'
import type { Basemap } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { basemapLabel } from './basemapLabel'

const b = (id: string, label: string): Basemap => ({ id, label, tiles: ['x'], attribution: '', max_zoom: 18, overlay: null })

describe('basemap labels', () => {
  it('the_built_in_ids_read_in_the_ui_language', () => {
    expect(basemapLabel(b('map', 'Map'), t('ja'))).toBe('地図')
    expect(basemapLabel(b('gsi_std', 'GSI standard'), t('ja'))).toBe('地理院 標準')
    expect(basemapLabel(b('gsi_photo', 'GSI photo'), t('en'))).toBe('GSI photo')
    expect(basemapLabel(b('satellite', 'Satellite'), t('ko'))).toBe('위성 사진')
  })

  it('a_map_from_config_keeps_its_own_label', () => {
    expect(basemapLabel(b('local', '現場オルソ'), t('en'))).toBe('現場オルソ')
  })
})
