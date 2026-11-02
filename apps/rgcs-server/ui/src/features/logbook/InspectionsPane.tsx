// Saved inspection runs (newest first); a row expands to its item results.
import { useState } from 'react'
import type { InspectionRun } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { placeText } from './format'

interface Props {
  readonly runs: readonly InspectionRun[] | null
  readonly error: string | null
  readonly dict: Dict
  /** Offered on an expanded run when set (日常点検 tab only). */
  readonly onCorrect?: (run: InspectionRun) => void
}

function resultText(r: InspectionRun['results'][number]['result'], dict: Dict): string {
  return r === 'ok' ? dict.lbResultOk : r === 'ng' ? dict.lbResultNg : dict.lbResultSkipped
}

function summary(run: InspectionRun, dict: Dict): string {
  const ok = run.results.filter((r) => r.result === 'ok').length
  return `${ok}/${run.results.length} ${dict.lbResultOk}`
}

export function InspectionsPane({ runs, error, dict, onCorrect }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="surface">
      <div className="row hair lb-head">
        <span className="h2">{dict.lbSubInspections}</span>
      </div>
      <div className="lb-table">
        {error && <div className="warnbox fatal">{error}</div>}
        {runs !== null && runs.length === 0 && <div className="t3 lb-empty">{dict.lbNoRuns}</div>}
        {runs !== null && runs.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>{dict.lbDate}</th>
                <th>{dict.lbInspector}</th>
                <th>{dict.lbResult}</th>
                <th>{dict.lbNotes}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const ng = run.results.filter((r) => r.result === 'ng').length
                const expanded = open === run.id
                return [
                  <tr key={run.id} data-testid="inspection-run" className={`selectable${expanded ? ' expanded' : ''}`} onClick={() => setOpen(expanded ? null : run.id)}>
                    <td className="num">{run.performed_on}</td>
                    <td>{run.inspector}</td>
                    <td>
                      {summary(run, dict)}
                      {ng > 0 && <span className="badge ng" style={{ marginLeft: 8 }}>{`${dict.lbResultNg} ${ng}`}</span>}
                    </td>
                    <td>{run.notes}</td>
                  </tr>,
                  expanded && (
                    <tr key={`${run.id}-items`} className="expanded">
                      <td colSpan={4}>
                        <div className="row" style={{ gap: 10 }}>
                          <span className="lb-muted">{`${dict.lbPlace}: ${placeText(run.place, run.lat, run.lon)}`}</span>
                          <span className="grow" />
                          {onCorrect && (
                            <button type="button" className="btn sm" onClick={() => onCorrect(run)}>
                              {dict.lbCorrect}
                            </button>
                          )}
                        </div>
                        <table className="tbl">
                          <tbody>
                            {run.results.map((r) => (
                              <tr key={r.position}>
                                <td>{r.label}</td>
                                <td className={r.result === 'ng' ? 'badge ng' : undefined}>{resultText(r.result, dict)}</td>
                                <td>{r.remark}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
