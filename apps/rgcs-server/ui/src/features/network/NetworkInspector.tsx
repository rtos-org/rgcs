// The network view's right panel (prototype lines 711–725): icon tile, title, kv rows, tables, note.
import type { ReactElement } from 'react'
import { IconCable, IconCopter, IconGlobe, IconLaptop, IconRadioTower, IconRouter, IconRover, IconServer, IconVideo } from '../../shared/ui/icons'
import type { InspectIcon, Inspection, Table } from './inspect'

const ICONS: Readonly<Record<InspectIcon, (p: { size?: number }) => ReactElement>> = {
  server: IconServer,
  cable: IconCable,
  copter: IconCopter,
  rover: IconRover,
  laptop: IconLaptop,
  router: IconRouter,
  globe: IconGlobe,
  'radio-tower': IconRadioTower,
  video: IconVideo,
}

const TILE = { width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--accent-tint)', color: 'var(--accent)', flex: 'none' } as const
const SMALL = { fontSize: 12 } as const

function InspectTable({ tb }: { readonly tb: Table }) {
  return (
    <div>
      <div className="t3" style={{ ...SMALL, marginBottom: 6 }}>
        {tb.title}
      </div>
      <div className="ntable" style={{ gridTemplateColumns: tb.cols }}>
        {tb.head.map((h, i) => (
          <span key={`h${i}`} className="th">
            {h}
          </span>
        ))}
        {tb.rows.flatMap((r, ri) =>
          r.map((c, ci) => (
            <span key={`${ri}:${ci}`} className={c.cls} title={c.v}>
              {c.v}
            </span>
          )),
        )}
      </div>
    </div>
  )
}

export function NetworkInspector({ ins }: { readonly ins: Inspection }) {
  const Icon = ICONS[ins.icon]
  return (
    <aside className="g panel float float-r" data-testid="network-inspector">
      <div className="panel-h">
        <span style={TILE}>
          <Icon size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="h1 ell">{ins.title}</div>
          <div className="t3 ell" style={SMALL}>
            {ins.sub}
          </div>
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="kv">
          {ins.kv.flatMap((r) => [
            <span key={`k:${r.k}`}>{r.k}</span>,
            <span key={`v:${r.k}`} className={r.cls}>
              {r.v}
            </span>,
          ])}
        </div>
        {ins.tables.map((tb) => (
          <InspectTable key={tb.title} tb={tb} />
        ))}
        {ins.note !== undefined && (
          <div className="t3" style={{ ...SMALL, lineHeight: 1.6 }}>
            {ins.note}
          </div>
        )}
      </div>
    </aside>
  )
}
