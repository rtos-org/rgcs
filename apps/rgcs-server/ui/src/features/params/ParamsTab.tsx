import { useState } from 'react'
import type { ParamProgress } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { formatNumber, parseInput, type Changes } from './changes'
import { MAX_ROWS, progressPct, progressText } from './format'
import type { ParamMeta } from './meta'
import type { ParamRow } from './search'
import { IconBits } from '../../shared/ui/icons'
import { BitmaskPopover } from './BitmaskPopover'

interface Props {
  readonly rows: readonly ParamRow[]
  readonly total: number
  readonly progress: ParamProgress | null
  readonly query: string
  readonly changes: Changes
  readonly busy: boolean
  readonly dict: Dict
  readonly onQuery: (q: string) => void
  readonly onRefresh: () => void
  readonly onChange: (name: string, value: number) => void
}

function rangeText(meta: ParamMeta | undefined): string {
  if (!meta?.r) return ''
  return `${formatNumber(meta.r[0])} – ${formatNumber(meta.r[1])}`
}

/** The bit editor button for parameters with `@Bitmask` metadata. */
function BitsButton({ row, value, dict, onChange }: { row: ParamRow; value: number; dict: Dict; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false)
  const bits = row.meta?.b
  if (!bits || Object.keys(bits).length === 0) return null
  return (
    <>
      <button type="button" className="btn-icon sm" aria-label={dict.bitsOpen} title={dict.bitsOpen} onClick={() => setOpen((o) => !o)}>
        <IconBits />
      </button>
      {open && (
        <BitmaskPopover
          name={row.name}
          value={value}
          bits={bits}
          dict={dict}
          onClose={() => setOpen(false)}
          onApply={(v) => {
            setOpen(false)
            onChange(v)
          }}
        />
      )}
    </>
  )
}

/** One editable value cell: a select for enumerated parameters, a number input otherwise. */
function ValueCell({ row, pendingValue, dict, onChange }: { row: ParamRow; pendingValue: number | undefined; dict: Dict; onChange: (v: number) => void }) {
  const shown = pendingValue ?? row.value
  const [text, setText] = useState<string | null>(null)
  const [bad, setBad] = useState<string | null>(null)
  const values = row.meta?.v
  if (values && Object.keys(values).length > 0 && Object.keys(values).length <= 32) {
    return (
      <select className="in sm" value={String(shown)} aria-label={row.name} onChange={(e) => onChange(Number(e.target.value))}>
        {!(String(shown) in values) && <option value={String(shown)}>{formatNumber(shown)}</option>}
        {Object.entries(values).map(([v, label]) => (
          <option key={v} value={v}>
            {label} ({v})
          </option>
        ))}
      </select>
    )
  }
  const commit = () => {
    if (text === null) return
    const parsed = parseInput(text, row.meta)
    if (parsed.ok) {
      setBad(null)
      onChange(parsed.value)
    } else {
      setBad(parsed.reason === 'range' ? dict.paramOutOfRange : dict.paramNotANumber)
    }
    setText(null)
  }
  return (
    <span className={`param-edit${bad ? ' bad' : ''}`} title={bad ?? undefined}>
      <input
        type="number"
        className="in sm num"
        aria-label={row.name}
        value={text ?? formatNumber(shown)}
        step={row.meta?.i ?? 'any'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setText(null)
        }}
      />
      {row.meta?.v && <span className="t3 param-enum">{row.meta.v[String(shown)]}</span>}
      <BitsButton row={row} value={shown} dict={dict} onChange={onChange} />
    </span>
  )
}

/** Toolbar (search, progress, refresh) and the table. */
export function ParamsTab({ rows, total, progress, query, changes, busy, dict, onQuery, onRefresh, onChange }: Props) {
  const pct = progressPct(progress, total)
  const shown = rows.slice(0, MAX_ROWS)
  return (
    <div className="surface params-tab">
      <div className="row hair params-toolbar">
        <input type="search" className="in grow" placeholder={dict.paramSearch} aria-label={dict.paramSearch} value={query} onChange={(e) => onQuery(e.target.value)} />
        <span className="params-progress num t2" title={dict.paramProgress}>
          {progressText(progress, total, dict)}
          {pct !== null && (
            <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={dict.paramProgress}>
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
        <button type="button" className="btn" onClick={onRefresh} disabled={busy || progress?.downloading === true}>
          {dict.paramRefresh}
        </button>
      </div>
      <div className="params-scroll">
        {total === 0 && <div className="t3 params-empty">{progress?.downloading ? dict.paramDownloading : dict.paramEmpty}</div>}
        {total > 0 && (
          <table className="tbl params-table">
            <thead>
              <tr>
                <th>{dict.paramName}</th>
                <th>{dict.paramValue}</th>
                <th>{dict.paramUnit}</th>
                <th>{dict.paramDescription}</th>
                <th>{dict.paramRange}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const pendingValue = changes.get(row.name)
                return (
                  <tr key={row.name} className={pendingValue === undefined ? undefined : 'changed'}>
                    <td>
                      <div className="mono param-name">{row.name}</div>
                      {row.meta && <div className="t3 param-dn">{row.meta.n}</div>}
                    </td>
                    <td className="param-value">
                      <ValueCell row={row} pendingValue={pendingValue} dict={dict} onChange={(v) => onChange(row.name, v)} />
                    </td>
                    <td className="t2">{row.meta?.u ?? ''}</td>
                    <td className="t2 param-desc">
                      {row.meta?.d ?? ''}
                      {row.meta?.reboot && <span className="badge reboot">{dict.paramReboot}</span>}
                    </td>
                    <td className="num t3">{rangeText(row.meta)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {rows.length > MAX_ROWS && (
          <div className="t3 params-more">{dict.paramMore.replace('{n}', String(rows.length)).replace('{m}', String(MAX_ROWS))}</div>
        )}
      </div>
    </div>
  )
}
