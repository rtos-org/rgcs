import { afterEach, describe, expect, it } from 'vitest'
import { loadSaved, mergeValues, saveValues } from './saved'

describe('last known path parameters per vehicle (browser storage)', () => {
  afterEach(() => localStorage.clear())
  it('newer vehicle values replace saved ones and unknown names keep their saved value', () => {
    expect(mergeValues({ A: 1, B: 2 }, { B: 3, C: 4 })).toEqual({ A: 1, B: 3, C: 4 })
  })
  it('round-trips through storage per sysid and survives garbage', () => {
    saveValues(4, { WP_LOITER_RAD: -80 })
    expect(loadSaved(4)).toEqual({ WP_LOITER_RAD: -80 })
    expect(loadSaved(5)).toEqual({})
    localStorage.setItem('rgcs.pathParams.6', '{not json')
    expect(loadSaved(6)).toEqual({})
    localStorage.setItem('rgcs.pathParams.7', JSON.stringify({ A: 'x', B: 2 }))
    expect(loadSaved(7)).toEqual({ B: 2 })
  })
})
