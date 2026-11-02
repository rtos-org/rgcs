// Whether the survey photo footprints are shown on the map, remembered per browser in `rgcs.surveyFoot`.
import { useCallback, useState } from 'react'

const KEY = 'rgcs.surveyFoot'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function useFootToggle() {
  const [on, setOn] = useState(read)
  const toggle = useCallback(() => {
    const next = !on
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // blocked storage: the choice lasts the session
    }
    setOn(next)
  }, [on])
  return { on, toggle }
}
