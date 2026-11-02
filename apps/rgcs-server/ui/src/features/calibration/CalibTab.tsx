// メンテナンス › 点検・校正: a card per calibration with its last date, the live
// session from the `calibration` frames, motor test and ESC calibration behind a props-off switch.
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { CalibKind, CalibRecord, CalibStatus, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { pickParams } from '../flightpath/usePathParams'
import { getCalibration, rebootVehicle, startCalibration, startEsc, stepCalibration, type CalibStep } from './api'
import { CalibCard } from './CalibCard'
import { calibKinds, cardStatus, isActive, motorCount } from './status'

const FRAME_PARAMS = ['FRAME_CLASS', 'Q_FRAME_CLASS', 'Q_ENABLE']

interface Props {
  readonly sysid: number
  readonly vehicle: VehicleState | undefined
  /** The vehicle's last `calibration` frame. */
  readonly session: CalibStatus | undefined
  readonly dict: Dict
}

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))

export function CalibTab({ sysid, vehicle, session, dict }: Props) {
  const [records, setRecords] = useState<readonly CalibRecord[]>([])
  const [frame, setFrame] = useState<Readonly<Record<string, number>>>({})
  const [open, setOpen] = useState<CalibKind | null>(null)
  /** The card whose session this screen started (or saw running) — its result stays until closed. */
  const [started, setStarted] = useState<CalibKind | null>(null)
  const [local, setLocal] = useState<CalibStatus | null>(null)
  const [busy, setBusy] = useState(false)
  // the 30-day check needs day precision: the time the tab opened is enough
  const [now] = useState(Date.now)
  const [error, setError] = useState<string | null>(null)
  // undefined first, so a session already running when the tab opens is shown too
  const [seen, setSeen] = useState<CalibStatus | undefined>(undefined)
  if (session !== seen) {
    setSeen(session)
    if (session && isActive(session)) {
      setOpen(session.kind)
      setStarted(session.kind)
    }
  }
  const reload = useCallback(() => {
    getCalibration(sysid)
      .then((o) => setRecords(o.records))
      .catch(() => {})
  }, [sysid])
  useEffect(() => {
    reload()
    pickParams(sysid, FRAME_PARAMS)
      .then((p) => setFrame(p.values))
      .catch(() => {})
  }, [sysid, reload])
  const finished = session !== undefined && !isActive(session)
  useEffect(() => {
    if (finished) reload()
  }, [finished, reload])

  const live = session ?? local
  const statusOf = (kind: CalibKind) => (started === kind && live?.kind === kind ? live : null)
  const call = (fn: () => Promise<CalibStatus | null>) => {
    setBusy(true)
    setError(null)
    fn()
      .then((s) => s && setLocal(s))
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }
  const start = (kind: CalibKind) => {
    setStarted(kind)
    call(() => (kind === 'esc' ? startEsc(sysid) : startCalibration(sysid, kind)))
  }
  const step = (s: CalibStep) => call(() => stepCalibration(sysid, s))
  const close = () => {
    setOpen(null)
    setStarted(null)
    setError(null)
    reload()
  }
  const locked = vehicle?.armed === true
  const latest = new Map(records.map((r) => [r.kind, r]))
  return (
    <div className="maint-body calib-body">
      {locked && <div className="t3 sev-warn calib-note">{dict.calArmed}</div>}
      <div className="calib-grid">
        {calibKinds(vehicle?.kind ?? null, (frame.Q_ENABLE ?? 0) >= 1).map((kind) => (
          <CalibCard
            key={kind}
            kind={kind}
            sysid={sysid}
            card={cardStatus(kind, latest.get(kind), now, dict)}
            open={open === kind}
            status={statusOf(kind)}
            locked={locked}
            busy={busy}
            error={open === kind ? error : null}
            motors={motorCount(frame)}
            dict={dict}
            onOpen={() => {
              setOpen(kind)
              setError(null)
            }}
            onClose={close}
            onStart={() => start(kind)}
            onStep={step}
            onReboot={() => void rebootVehicle(sysid).catch((e: unknown) => setError(message(e)))}
            onRecorded={reload}
          />
        ))}
      </div>
    </div>
  )
}
