// The plan comparison table on the planner's right panel (spec 2026-10-20 §5.4): distance
// first and large; time and battery are estimates (目安) and the battery turns amber over 70 %.
// The vehicle column lists the vehicles each saved plan is assigned to; writing them is the
// assignment board's job (spec 2026-10-31 §9).
import type { Dict } from '../../shared/i18n'
import { km, mmss } from '../mission/labels'
import type { CompareRow } from './compare'

export interface CompareLine extends CompareRow {
  readonly color: string
  readonly name: string
  /** The names of the vehicles the plan is assigned to (server assignments); empty = none. */
  readonly vehicles: readonly string[]
}

interface Props {
  readonly lines: readonly CompareLine[]
  readonly dict: Dict
}

function Line({ line }: { readonly line: CompareLine }) {
  return (
    <tr>
      <td className="plans-cmp-name">
        <span className="plans-dot" style={{ background: line.color }} aria-hidden="true" />
        {line.name}
      </td>
      <td className={line.vehicles.length === 0 ? 't3' : ''}>{line.vehicles.length === 0 ? '—' : line.vehicles.join(', ')}</td>
      <td className="num">
        <span className="big">{km(line.distanceM)}</span>
      </td>
      <td className="num">{mmss(line.durationS)}</td>
      <td className={`num${line.batteryWarn ? ' warn' : ''}`}>{line.batteryPct === null ? '—' : `${line.batteryPct}%`}</td>
    </tr>
  )
}

export function CompareTable({ lines, dict }: Props) {
  return (
    <div className="sec plans-cmp" data-testid="plans-compare">
      <div className="h1" style={{ marginBottom: 8 }}>
        {dict.plCompare}
      </div>
      <table className="plans-cmp-table">
        <thead>
          <tr>
            <th>{dict.plColMission}</th>
            <th>{dict.plColVehicle}</th>
            <th>{dict.plColDistance}</th>
            <th>{dict.plColTime}</th>
            <th>{dict.plColBattery}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <Line key={l.key} line={l} />
          ))}
        </tbody>
      </table>
      <div className="t4 plans-cmp-note">{dict.plBatteryNote}</div>
    </div>
  )
}
