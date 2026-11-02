import { useEffect, useState } from 'react'
import type { ParamHistoryEntry, SysId } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { getParamHistory } from './api'
import { historyText, historyTime } from './format'
import { VerifiedMark } from './VerifiedMark'

interface Props {
  readonly sysid: SysId | null
  readonly dict: Dict
  /** Bumped by the parent after a write so the table reloads. */
  readonly version: number
}

/** `param_history` for the selected vehicle: 時刻 / オペレータ / 変更内容 / 検証 (no 機体 column: the list is that vehicle's). */
export function HistoryTab({ sysid, dict, version }: Props) {
  const [rows, setRows] = useState<readonly ParamHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    getParamHistory(sysid)
      .then((r) => live && setRows(r))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [sysid, version])
  return (
    <div className="surface params-history">
      {error && <div className="warnbox fatal">{error}</div>}
      {rows !== null && rows.length === 0 && <div className="t3 params-empty">{dict.paramHistoryEmpty}</div>}
      {rows !== null && rows.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>{dict.histTime}</th>
              <th>{dict.histOperator}</th>
              <th>{dict.histChange}</th>
              <th>{dict.histVerify}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.verified ? undefined : 'unverified'}>
                <td className="num t2">{historyTime(e.ts)}</td>
                <td>{e.operator}</td>
                <td className="num">{historyText(e)}</td>
                <td>
                  <VerifiedMark ok={e.verified} dict={dict} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
