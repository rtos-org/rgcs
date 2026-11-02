// ログ sub-tab: stored DataFlash logs with download and flight
// attachment, the flight controller's log list with MAVLink fetch (progress over WS),
// and a browser upload for logs taken off the SD card.
import { useEffect, useState } from 'react'
import type { FcLogEntry, Flight, FlightLog, LogFetchProgress } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { attachLog, fetchLog, listFcLogs, listFlights, listLogs, logFileUrl, uploadLog } from './api'
import { jstDate, jstTime, sizeText } from './format'

interface Props {
  readonly sysid: number
  readonly from: string
  readonly to: string
  readonly dict: Dict
  readonly progress: LogFetchProgress | undefined
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function flightLabel(f: Flight): string {
  return `${jstDate(f.takeoff_at)} ${jstTime(f.takeoff_at)}`
}

interface FlightSelectProps {
  readonly id?: string
  readonly label: string
  readonly flights: readonly Flight[]
  readonly value: number | null
  readonly dict: Dict
  readonly onChange: (v: number | null) => void
}

function FlightSelect({ id, label, flights, value, dict, onChange }: FlightSelectProps) {
  return (
    <select id={id} className="in sm" aria-label={label} value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">{dict.lbNoFlight}</option>
      {flights.map((f) => (
        <option key={f.id} value={f.id}>
          {flightLabel(f)}
        </option>
      ))}
    </select>
  )
}

interface StoredProps {
  readonly sysid: number
  readonly logs: readonly FlightLog[] | null
  readonly flights: readonly Flight[]
  readonly dict: Dict
  readonly onAttached: (log: FlightLog) => void
  readonly onError: (m: string) => void
}

function StoredLogs({ sysid, logs, flights, dict, onAttached, onError }: StoredProps) {
  const attach = (log: FlightLog, flightId: number | null) => {
    attachLog(sysid, log.id, flightId).then(onAttached).catch((e: unknown) => onError(message(e)))
  }
  return (
    <div className="surface">
      <div className="row hair lb-head">
        <span className="h2">{dict.lbLogsStored}</span>
      </div>
      <div className="lb-table">
        {logs !== null && logs.length === 0 && <div className="t3 lb-empty">{dict.lbNoLogs}</div>}
        {logs !== null && logs.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>{dict.lbFile}</th>
                <th>{dict.lbSize}</th>
                <th>{dict.lbFetchedAt}</th>
                <th>{dict.lbSource}</th>
                <th>{dict.lbAttachTo}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} data-testid="log-row">
                  <td className="mono">{l.filename}</td>
                  <td className="num">{sizeText(l.size)}</td>
                  <td className="num">{`${jstDate(l.fetched_at)} ${jstTime(l.fetched_at)}`}</td>
                  <td>{l.source}</td>
                  <td>
                    <FlightSelect label={dict.lbAttachTo} flights={flights} value={l.flight_id} dict={dict} onChange={(v) => attach(l, v)} />
                  </td>
                  <td>
                    <a className="btn sm" href={logFileUrl(sysid, l.id)} download>
                      {dict.lbDownload}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ProgressRow({ progress, dict }: { progress: LogFetchProgress; dict: Dict }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.received / progress.total) * 100)
  return (
    <div className="lb-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span>{`${dict.lbFetching} ${sizeText(progress.received)} / ${sizeText(progress.total)}`}</span>
      <span className="bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

export function LogsPane({ sysid, from, to, dict, progress }: Props) {
  const [enabled, setEnabled] = useState(true)
  const [logs, setLogs] = useState<readonly FlightLog[] | null>(null)
  const [flights, setFlights] = useState<readonly Flight[]>([])
  const [fc, setFc] = useState<readonly FcLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploadFlight, setUploadFlight] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  const doneKey = progress?.done ? `${progress.fc_log_id}:${progress.received}` : null
  const [seenDone, setSeenDone] = useState(doneKey)
  if (doneKey !== seenDone) {
    setSeenDone(doneKey)
    if (doneKey !== null) setVersion((n) => n + 1)
  }

  useEffect(() => {
    let live = true
    listLogs(sysid)
      .then((r) => {
        if (!live) return
        setEnabled(r.fetch_enabled)
        setLogs(r.logs)
      })
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid, version])

  useEffect(() => {
    let live = true
    listFlights(sysid, from, to)
      .then((f) => live && setFlights(f))
      .catch((e: unknown) => live && setError(message(e)))
    return () => {
      live = false
    }
  }, [sysid, from, to])

  const listFc = async () => {
    setBusy(true)
    setError(null)
    try {
      setFc(await listFcLogs(sysid))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const fetchOne = async (entry: FcLogEntry) => {
    setError(null)
    try {
      await fetchLog(sysid, entry.id, null)
    } catch (e) {
      setError(message(e))
    }
  }

  const upload = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadLog(sysid, file, uploadFlight)
      setFile(null)
      setVersion((n) => n + 1)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const fetching = progress !== undefined && !progress.done
  return (
    <div className="maint-body lb-grid" style={{ flex: 1 }}>
      <StoredLogs sysid={sysid} logs={logs} flights={flights} dict={dict} onAttached={(l) => setLogs((r) => (r ?? []).map((x) => (x.id === l.id ? l : x)))} onError={setError} />
      <div className="surface">
        <div className="row hair lb-head">
          <span className="h2">{dict.lbLogsOnVehicle}</span>
          <span className="grow" />
          {enabled && (
            <button type="button" className="btn sm" disabled={busy || fetching} onClick={() => void listFc()}>
              {dict.lbListFc}
            </button>
          )}
        </div>
        <div className="lb-body">
          {!enabled && <div className="warnbox">{dict.lbFetchDisabled}</div>}
          {error && <div className="warnbox fatal">{error}</div>}
          {progress?.done && progress.error && <div className="warnbox fatal">{progress.error}</div>}
          {fetching && <ProgressRow progress={progress} dict={dict} />}
          {enabled && fc !== null && fc.length === 0 && <div className="t3 lb-empty">{dict.lbNoLogs}</div>}
          {enabled && fc !== null && fc.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>{dict.lbDate}</th>
                  <th>{dict.lbSize}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fc.map((e) => (
                  <tr key={e.id} data-testid="fc-row">
                    <td className="num">{e.id}</td>
                    <td className="num">{`${jstDate(e.time_utc * 1000)} ${jstTime(e.time_utc * 1000)}`}</td>
                    <td className="num">{sizeText(e.size)}</td>
                    <td>
                      <button type="button" className="btn sm" disabled={fetching} onClick={() => void fetchOne(e)}>
                        {dict.lbFetch}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lb-form">
            <label htmlFor="log-file">{dict.lbFile}</label>
            <input id="log-file" className="in" type="file" accept=".bin,.BIN" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <label htmlFor="log-upload-flight">{`${dict.lbAttachTo}(アップロード)`}</label>
            <FlightSelect id="log-upload-flight" label={`${dict.lbAttachTo}(アップロード)`} flights={flights} value={uploadFlight} dict={dict} onChange={setUploadFlight} />
          </div>
        </div>
        <div className="lb-foot">
          <button type="button" className="btn btn-primary" disabled={busy || file === null} onClick={() => void upload()}>
            {dict.lbUpload}
          </button>
        </div>
      </div>
    </div>
  )
}
