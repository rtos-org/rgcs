import { useRef, type ChangeEvent } from 'react'
import type { RoiControl, RoiMode, RoiTarget } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { Issue } from '../camera-settings/schema'
import { decodeCsvBytes, parseRoiCsv, toRoiTargets, type CsvError } from './csv'
import { RoiControlForm } from './RoiControlForm'
import { isSet } from './schema'

export interface RoiTabProps {
  readonly targets: readonly RoiTarget[]
  readonly control: RoiControl
  readonly activeId: string | null
  readonly targetsIssue: Issue | null
  readonly controlIssue: Issue | null
  readonly onTargets: (t: RoiTarget[]) => void
  readonly onControl: (c: RoiControl) => void
  readonly onPickOnMap: () => void
  readonly onCsvError: (msg: string) => void
  /** `caps.roi`: with `native` the autopilot aims the gimbal, so the rate / angle control block is hidden. */
  readonly roiMode?: RoiMode
  readonly dict: Dict
}

export function csvErrorMessage(e: CsvError, dict: Dict): string {
  const reason = dict[`roiCsvReason_${e.code}`]
  return e.code === 'empty' ? reason : dict.roiCsvError.replace('{line}', String(e.line)).replace('{reason}', reason)
}

/** The camera settings ROI tab: 10 presets, 地図で指定 / CSV, then the control block (or the native ROI note). */
export function RoiTab({ targets, control, activeId, targetsIssue, controlIssue, onTargets, onControl, onPickOnMap, onCsvError, roiMode = 'computed', dict }: RoiTabProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const setName = (i: number, name: string) => onTargets(targets.map((t, j) => (j === i ? { ...t, name } : t)))
  const importCsv = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const parsed = parseRoiCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())))
    const first = parsed.errors[0]
    if (first) onCsvError(csvErrorMessage(first, dict))
    else onTargets(toRoiTargets(parsed.rows))
  }
  return (
    <>
      <div>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="ttl">{dict.roiPresets}</span>
          <div className="grow" />
          <button type="button" className="btn btn-sm" onClick={onPickOnMap}>
            {dict.pickOnMap}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label={dict.roiCsvFile} hidden onChange={(e) => void importCsv(e)} />
        </div>
        <table className="tbl compact">
          <thead>
            <tr>
              <th>#</th>
              <th>{dict.roiName}</th>
              <th style={{ textAlign: 'right' }}>{dict.roiLat}</th>
              <th style={{ textAlign: 'right' }}>{dict.roiLon}</th>
              <th style={{ textAlign: 'right' }}>{dict.roiMsl}</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t, i) => (
              <RoiRow key={t.id} n={i + 1} target={t} on={t.id === activeId} bad={targetsIssue?.path.startsWith(`${i}.`) ?? false} onName={(name) => setName(i, name)} dict={dict} />
            ))}
          </tbody>
        </table>
        <div className="t3" style={{ fontSize: 11, marginTop: 8 }}>
          {roiMode === 'native' ? dict.roiNoteNative : dict.roiNote}
        </div>
        {targetsIssue && <span className="danger settings-issue">{targetsIssue.path}: {targetsIssue.message}</span>}
      </div>
      {roiMode === 'native' ? (
        <div className="t2" style={{ fontSize: 12 }}>
          {dict.roiNativeNote}
        </div>
      ) : (
        <RoiControlForm control={control} issue={controlIssue} onChange={onControl} dict={dict} />
      )}
    </>
  )
}

interface RowProps {
  readonly n: number
  readonly target: RoiTarget
  readonly on: boolean
  readonly bad: boolean
  readonly onName: (name: string) => void
  readonly dict: Dict
}

function RoiRow({ n, target, on, bad, onName, dict }: RowProps) {
  const set = isSet(target)
  return (
    <tr className={on ? 'on' : ''}>
      <td className="mono t3">{n}</td>
      <td>
        <input className={bad ? 'in invalid' : 'in'} aria-label={`${dict.roiName} ${n}`} value={target.name} placeholder="—" style={{ width: 110 }} onChange={(e) => onName(e.target.value)} />
      </td>
      <td className="num t2" style={{ textAlign: 'right' }}>
        {set ? target.lat.toFixed(5) : ''}
      </td>
      <td className="num t2" style={{ textAlign: 'right' }}>
        {set ? target.lon.toFixed(5) : ''}
      </td>
      <td className="num t2" style={{ textAlign: 'right' }}>
        {set ? `${Math.round(target.alt_msl)} m` : ''}
      </td>
    </tr>
  )
}
