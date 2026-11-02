import { describe, expect, it } from 'vitest'
import { navigate, navViewOf } from './rightPanel'

describe('right panel navigation', () => {
  it('ai from another view opens the ops map with the AI panel', () => {
    expect(navigate({ view: 'video', right: 'detail' }, 'ai')).toEqual({ view: 'ops', right: 'ai' })
    expect(navigate({ view: 'ops', right: 'detail' }, 'ai')).toEqual({ view: 'ops', right: 'ai' })
  })

  it('ai again on the ops map closes the panel back to detail', () => {
    expect(navigate({ view: 'ops', right: 'ai' }, 'ai')).toEqual({ view: 'ops', right: 'detail' })
  })

  it('ops always shows the detail panel', () => {
    expect(navigate({ view: 'ops', right: 'ai' }, 'ops')).toEqual({ view: 'ops', right: 'detail' })
  })

  it('other targets keep the right panel', () => {
    expect(navigate({ view: 'ops', right: 'ai' }, 'mission')).toEqual({ view: 'mission', right: 'ai' })
    expect(navigate({ view: 'ops', right: 'detail' }, 'maint')).toEqual({ view: 'maint', right: 'detail' })
  })

  it('the nav lens shows ai only on the ops map with the panel open', () => {
    expect(navViewOf({ view: 'ops', right: 'ai' })).toBe('ai')
    expect(navViewOf({ view: 'mission', right: 'ai' })).toBe('mission')
    expect(navViewOf({ view: 'ops', right: 'detail' })).toBe('ops')
  })
})
