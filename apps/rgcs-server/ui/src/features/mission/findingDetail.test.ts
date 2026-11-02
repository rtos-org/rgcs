import { describe, expect, it } from 'vitest'
import type { Finding, MissionItem } from '../../shared/api/types'
import { dictionaries } from '../../shared/i18n'
import { findingDetail } from './findingDetail'

const item = (command: number, params: [number, number, number, number]): MissionItem => ({ command, frame: 'rel', params, lat: 33.66, lon: 135.9, alt: 80, autocontinue: true })
const ignored = (seq: number, index: number, sent: number, stored: number): Finding => ({ level: 'warn', code: 'param_ignored', seq, message: '', param: { index, sent, stored } })

describe('findingDetail', () => {
  const items = [item(84, [0, 0, 0, 0]), item(31, [100, 0, 0, 0]), item(18, [1, 0, 25.5, 0])]

  it('says_a_dropped_param_reads_back_as_zero', () => {
    const ja = findingDetail(ignored(2, 1, 100, 0), items, dictionaries.ja)
    expect(ja).toBe('旋回して高度変更のパラメータ1 (100) は保存されず 0 になります')
    expect(findingDetail(ignored(2, 1, 100, 0), items, dictionaries.en)).toBe('Loiter to altitude param1 (100) is not stored: it reads back as 0')
  })

  it('names_a_known_field_and_its_stored_value', () => {
    const ja = findingDetail(ignored(3, 3, 25.5, 25), items, dictionaries.ja)
    expect(ja).toContain('半径 (25.5)')
    expect(ja).toContain('25 として保存されます')
  })

  it('has_no_detail_without_param_data', () => {
    expect(findingDetail({ level: 'warn', code: 'long_flight', seq: null, message: '' }, items, dictionaries.ja)).toBeNull()
  })

  it('falls_back_to_the_param_number_when_the_item_is_gone', () => {
    expect(findingDetail(ignored(9, 2, 5, 0), items, dictionaries.en)).toBe('param2 (5) is not stored: it reads back as 0')
  })
})
