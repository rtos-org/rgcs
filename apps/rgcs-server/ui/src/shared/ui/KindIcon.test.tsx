import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KindIcon } from './KindIcon'

describe('KindIcon', () => {
  it('draws a plane, a car or the multicopter by vehicle kind', () => {
    const d = (kind: 'plane' | 'rover' | 'copter' | 'other') => render(<KindIcon kind={kind} />).container.querySelector('svg')!.getAttribute('class') ?? ''
    expect(d('plane')).toContain('lucide-plane')
    expect(d('rover')).toContain('lucide-car')
    expect(d('copter')).not.toContain('lucide')
    expect(d('other')).not.toContain('lucide')
  })
})
