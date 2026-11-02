import { useEffect, useState } from 'react'
import { getCalibration } from './api'
import { needsAttention } from './status'

/**
 * Whether `sysid` has a calibration to check (detail panel's maintenance tile). Asked again when
 * the vehicle changes or `version` moves (a calibration session ended).
 */
export function useCalibAttention(sysid: number | null, version: unknown): boolean {
  const [state, setState] = useState<{ sysid: number | null; on: boolean }>({ sysid: null, on: false })
  useEffect(() => {
    if (sysid === null) return
    let alive = true
    getCalibration(sysid)
      .then((o) => alive && setState({ sysid, on: needsAttention(o.records, Date.now()) }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [sysid, version])
  return state.sysid === sysid && state.on
}
