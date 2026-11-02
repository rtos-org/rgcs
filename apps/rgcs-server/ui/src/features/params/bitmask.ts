// Bitmask parameters (ArduPilot `@Bitmask`, e.g. LOG_BITMASK, ARMING_CHECK): the value is an
// int32 whose bits are named; the helper edits bits and leaves undocumented bits untouched.

const BITS = 32

/** Bit numbers set in `value` (0 = least significant). */
export function bitsOf(value: number): number[] {
  const u = Math.trunc(value) >>> 0
  return Array.from({ length: BITS }, (_, b) => b).filter((b) => (u >>> b) & 1)
}

/** `value` with one bit set or cleared, as a signed int32 (ArduPilot bitmask parameters are INT32:
 * bit 31 must travel as −2³¹, since an unsigned 2³¹ saturates on the flight controller). */
export function withBit(value: number, bit: number, on: boolean): number {
  const mask = (1 << bit) >>> 0
  const u = Math.trunc(value) >>> 0
  return (on ? u | mask : u & ~mask) | 0
}

/** Set bits that the metadata does not name (kept as they are). */
export function unknownBits(value: number, names: Readonly<Record<string, string>>): number[] {
  return bitsOf(value).filter((b) => !(String(b) in names))
}
