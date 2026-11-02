import { describe, expect, it } from 'vitest'
import { bitsOf, unknownBits, withBit } from './bitmask'

const LOG = { '0': 'Fast Attitude', '1': 'Medium Attitude', '2': 'GPS', '10': 'RC output' }

describe('bitmask', () => {
  it('bits_of_a_value', () => {
    expect(bitsOf(0)).toEqual([])
    expect(bitsOf(5)).toEqual([0, 2])
    expect(bitsOf(1024 + 1)).toEqual([0, 10])
    expect(bitsOf(2 ** 31)).toEqual([31])
  })

  it('with_bit_sets_and_clears_one_bit_and_keeps_the_rest', () => {
    expect(withBit(5, 1, true)).toBe(7)
    expect(withBit(7, 0, false)).toBe(6)
    expect(withBit(6, 1, true)).toBe(6)
  })

  it('bit_31_is_sent_as_an_int32 (ArduPilot bitmasks are INT32; 2^31 as a float would not survive)', () => {
    expect(withBit(0, 31, true)).toBe(-(2 ** 31))
    expect(withBit(2 ** 31 + 1, 0, false)).toBe(-(2 ** 31))
    expect(bitsOf(withBit(0, 31, true))).toEqual([31])
  })

  it('negative values stay signed (ArduPilot uses -1 for all)', () => {
    expect(withBit(-1, 0, false)).toBe(-2)
  })

  it('unknown_bits_are_reported', () => {
    expect(unknownBits(1 + 8 + 1024, LOG)).toEqual([3])
  })
})
