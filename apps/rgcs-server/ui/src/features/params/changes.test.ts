import { describe, expect, it } from 'vitest'
import { EMPTY_CHANGES, clearChange, formatValue, parseInput, pending, rebootNeeded, setChange } from './changes'

const entries = new Map([
  ['FENCE_ALT_MAX', { name: 'FENCE_ALT_MAX', value: 100, index: 1, ptype: 9 }],
  ['FENCE_ENABLE', { name: 'FENCE_ENABLE', value: 0, index: 2, ptype: 2 }],
])
const meta = {
  FENCE_ENABLE: { n: 'Fence enable', d: '', v: { '0': 'Disabled', '1': 'Enabled' } },
  SERIAL1_BAUD: { n: 'baud', d: '', reboot: true },
  FENCE_ALT_MAX: { n: 'alt', d: '', u: 'm', r: [10, 1000] as [number, number] },
}

describe('change set', () => {
  it('change_set_is_immutable_and_tracks_reboot', () => {
    const a = setChange(EMPTY_CHANGES, 'FENCE_ALT_MAX', 150)
    const b = setChange(a, 'SERIAL1_BAUD', 57)
    expect(EMPTY_CHANGES.size).toBe(0)
    expect(a.size).toBe(1)
    expect(b.get('SERIAL1_BAUD')).toBe(57)
    expect(pending(b, entries)).toEqual([
      { name: 'FENCE_ALT_MAX', value: 150 },
      { name: 'SERIAL1_BAUD', value: 57 },
    ])
    // a change back to the current value drops out of the set
    expect(setChange(a, 'FENCE_ALT_MAX', 100, entries).size).toBe(0)
    expect(clearChange(b, 'SERIAL1_BAUD').size).toBe(1)
    expect(b.size).toBe(2)
  })

  it('reboot_required_is_flagged', () => {
    const b = setChange(setChange(EMPTY_CHANGES, 'FENCE_ALT_MAX', 150), 'SERIAL1_BAUD', 57)
    expect(rebootNeeded(b, meta)).toEqual(['SERIAL1_BAUD'])
    expect(rebootNeeded(setChange(EMPTY_CHANGES, 'FENCE_ALT_MAX', 150), meta)).toEqual([])
  })

  it('values_format_through_the_metadata', () => {
    expect(formatValue(1, meta.FENCE_ENABLE)).toBe('Enabled (1)')
    expect(formatValue(2, meta.FENCE_ENABLE)).toBe('2')
    expect(formatValue(150, meta.FENCE_ALT_MAX)).toBe('150')
    expect(formatValue(0.1 + 0.2, undefined)).toBe('0.3')
    expect(formatValue(1234.5678, undefined)).toBe('1234.568')
    expect(formatValue(0.0004, undefined)).toBe('0.0004')
    expect(formatValue(-0.00123456, undefined)).toBe('-0.00123456')
    expect(formatValue(0.1, undefined)).toBe('0.1')
  })

  it('input_parsing_rejects_garbage_and_out_of_range', () => {
    expect(parseInput('150', meta.FENCE_ALT_MAX)).toEqual({ ok: true, value: 150 })
    expect(parseInput('5', meta.FENCE_ALT_MAX)).toEqual({ ok: false, reason: 'range' })
    expect(parseInput('abc', undefined)).toEqual({ ok: false, reason: 'nan' })
    expect(parseInput(' 1e3 ', undefined)).toEqual({ ok: true, value: 1000 })
  })
})
