import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, profileSchema } from './profile'

describe('profileSchema', () => {
  it('accepts the default and rejects out-of-range values with the field path', () => {
    expect(profileSchema.safeParse(DEFAULT_PROFILE).success).toBe(true)
    const bad = profileSchema.safeParse({ ...DEFAULT_PROFILE, max_pan_speed: 500 })
    expect(bad.success).toBe(false)
    expect(bad.success ? [] : bad.error.issues[0]?.path).toEqual(['max_pan_speed'])
    const badDz = profileSchema.safeParse({ ...DEFAULT_PROFILE, axes: [{ ...DEFAULT_PROFILE.axes[0]!, deadzone: 0.9 }] })
    expect(badDz.success ? [] : badDz.error.issues[0]?.path).toEqual(['axes', 0, 'deadzone'])
  })
})
