// メンテナンス › MAVLink インスペクター (user request 2026-10-19): every message the link received and
// every message RGCS sent, per system / component, with rate and the last message's fields.
import { useEffect, useState } from 'react'
import type { CommandResult, InspectorDetail, InspectorList, InspectorRow, SysId, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconPause, IconPlay } from '../../shared/ui/icons'
import type { SendFn } from '../commands/useCommand'
import { RateControls } from './RateControls'
import { fetchInspector, fetchInspectorDetail } from './api'
import { fieldText } from './fields'
import { componentName, groupRows, rowKey } from './tree'

const POLL_MS = 1000

function usePolled(paused: boolean, selected: InspectorRow | null) {
  const [list, setList] = useState<InspectorList | null>(null)
  const [detail, setDetail] = useState<InspectorDetail | null>(null)
  useEffect(() => {
    if (paused) return undefined
    let alive = true
    const tick = () => {
      fetchInspector()
        .then((l) => alive && setList(l))
        .catch(() => {})
      if (selected)
        fetchInspectorDetail(selected)
          .then((d) => alive && setDetail(d))
          .catch(() => {})
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [paused, selected])
  return { list, detail: selected && detail && rowKey(detail.row) === rowKey(selected) ? detail : null }
}

function Tree({ list, filter, selected, dict, onSelect }: { list: InspectorList; filter: string; selected: string | null; dict: Dict; onSelect: (r: InspectorRow) => void }) {
  return (
    <>
      {groupRows(list.rows, filter).map((d) => (
        <div key={d.dir} className="insp-dir">
          <div className="t2 insp-dir-h">{d.dir === 'rx' ? dict.inspRx : `${dict.inspTx} (RGCS · SYSID ${list.gcs_sysid})`}</div>
          {d.systems.map((s) =>
            s.components.map((c) => (
              <div key={`${s.sysid}/${c.compid}`} className="insp-comp">
                <div className="t3 insp-comp-h num">
                  SYSID {s.sysid} · {componentName(c.compid)} ({c.compid})
                </div>
                {c.rows.map((r) => (
                  <button key={rowKey(r)} type="button" className={`insp-row${selected === rowKey(r) ? ' on' : ''}`} onClick={() => onSelect(r)}>
                    <span className="mono ell">{r.name}</span>
                    <span className="num t2">{r.rate_hz > 0 ? `${r.rate_hz.toFixed(1)} Hz` : '—'}</span>
                    <span className="num t3">{r.count}</span>
                  </button>
                ))}
              </div>
            )),
          )}
        </div>
      ))}
    </>
  )
}

interface TabProps {
  readonly dict: Dict
  /** Default to the live store (read by RateControls only); tests inject them. */
  readonly vehicles?: ReadonlyMap<SysId, VehicleState>
  readonly results?: readonly CommandResult[]
  readonly send?: SendFn
}

export function InspectorTab({ dict, vehicles, results, send }: TabProps) {
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [selected, setSelected] = useState<InspectorRow | null>(null)
  const { list, detail } = usePolled(paused, selected)
  return (
    <div className="maint-body insp">
      <div className="surface insp-list">
        <div className="row insp-tools">
          <input type="search" className="in grow" placeholder={dict.inspFilter} aria-label={dict.inspFilter} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="btn-icon" aria-label={paused ? dict.inspResume : dict.inspPause} title={paused ? dict.inspResume : dict.inspPause} onClick={() => setPaused((p) => !p)}>
            {paused ? <IconPlay /> : <IconPause />}
          </button>
        </div>
        <div className="insp-scroll">{list ? <Tree list={list} filter={filter} selected={selected && rowKey(selected)} dict={dict} onSelect={setSelected} /> : <div className="t3">{dict.connecting}</div>}</div>
      </div>
      <div className="surface insp-detail">
        {detail ? (
          <>
            <div className="h1 mono">{detail.row.name}</div>
            <div className="t3 num">
              {detail.row.dir === 'rx' ? dict.inspRx : dict.inspTx} · SYSID {detail.row.sysid} · {componentName(detail.row.compid)} · ID {detail.row.msg_id} · {detail.row.count} · {(detail.row.age_ms / 1000).toFixed(1)} s
            </div>
            <RateControls key={rowKey(detail.row)} row={detail.row} vehicles={vehicles} results={results} dict={dict} send={send} />
            <div className="kv insp-kv">
              {Object.entries(detail.fields).map(([k, v]) => (
                <div key={k} className="contents-row">
                  <span className="t2 mono">{k}</span>
                  <span className="mono">{fieldText(v)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="t3">{dict.inspPick}</div>
        )}
      </div>
    </div>
  )
}
