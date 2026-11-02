// The fused 外的要因 summary for the ops-map chip: `GET /api/env/factors` once (read-only), then
// every `env_summary` WS frame.
import { useEffect, useRef, useState } from 'react'
import type { EnvSummary } from '../../shared/api/types'
import { vehicleStore, type FrameSource } from '../vehicles/store'
import { getEnvFactors } from './api'

export function useEnvSummary(frames: FrameSource = vehicleStore, load: () => Promise<EnvSummary> = getEnvFactors): EnvSummary | null {
  const [summary, setSummary] = useState<EnvSummary | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let alive = true
    let framed = false
    loadRef
      .current()
      .then((s) => alive && !framed && setSummary(s))
      .catch(() => {}) // the chip shows 「外的要因: —」 until a frame arrives
    const off = frames.onFrame((msg) => {
      if (msg.t !== 'env_summary') return
      framed = true
      setSummary(msg.summary)
    })
    return () => {
      alive = false
      off()
    }
  }, [frames])
  return summary
}
