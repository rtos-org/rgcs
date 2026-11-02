// The ネットワーク screen (10 §8): title bar with summary and legend, the canvas, and the inspector.
// The selection (`netSel`) is client-only (10 §9); it survives 1 Hz refreshes and falls back to the
// server when the selected element disappears.
import { useMemo, useState } from 'react'
import type { Dict } from '../../shared/i18n'
import type { NetworkTopology } from '../../shared/api/types'
import { graphSummary, toGraph } from './graph'
import { inspect, selectionExists } from './inspect'
import { NetworkCanvas } from './NetworkCanvas'
import { NetworkInspector } from './NetworkInspector'
import { useNetwork } from './useNetwork'

export interface NetworkViewProps {
  /** The reducer's last `network_status` topology. */
  readonly ws: NetworkTopology | null
  readonly dict: Dict
}

const LEGEND_DIRECT = { borderTop: '1.5px solid var(--accent)', opacity: 0.6 } as const
const LEGEND_RTC = { borderColor: 'var(--alt-hi)' } as const
const LEGEND_RTCM = { borderTop: '2.5px dotted var(--ok)' } as const

function Legend({ dict }: { readonly dict: Dict }) {
  return (
    <>
      <span className="lg" title={dict.netUnconfigured}>
        <i />
        {dict.netInet}
      </span>
      <span className="lg">
        <i style={LEGEND_DIRECT} />
        {dict.netDirect}
      </span>
      <span className="lg">
        <i style={LEGEND_RTC} />
        {dict.netRtc}
      </span>
      <span className="lg" title={dict.netUnconfigured}>
        <i style={LEGEND_RTCM} />
        {dict.netRtcm}
      </span>
    </>
  )
}

function Loaded({ topology, dict }: { readonly topology: NetworkTopology; readonly dict: Dict }) {
  const [picked, setPicked] = useState('server')
  const graph = useMemo(() => toGraph(topology), [topology])
  const sel = selectionExists(picked, topology, dict) ? picked : 'server'
  const ins = useMemo(() => inspect(sel, topology, dict, topology.at_unix_ms), [sel, topology, dict])
  return (
    <>
      <section className="float top1 netwrap" data-testid="network-view">
        <div className="netbar">
          <span className="h1">{dict.netTitle}</span>
          <span className="t3 num" style={{ fontSize: 12 }}>
            {graphSummary(graph, dict)}
          </span>
          <div className="grow" />
          <Legend dict={dict} />
        </div>
        <NetworkCanvas graph={graph} selected={sel} onSelect={setPicked} dict={dict} />
      </section>
      <NetworkInspector ins={ins} />
    </>
  )
}

export function NetworkView({ ws, dict }: NetworkViewProps) {
  const { topology, error } = useNetwork(ws)
  if (topology !== null) return <Loaded topology={topology} dict={dict} />
  return (
    <section className="float top1 netwrap" data-testid="network-view">
      <div className="netbar">
        <span className="h1">{dict.netTitle}</span>
      </div>
      <div className="netmap g">
        <div className="nethint">{error === null ? dict.netLoading : dict.netLoadFailed}</div>
      </div>
    </section>
  )
}
