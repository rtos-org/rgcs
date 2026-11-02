// Sends commands from any operator surface (全コマンド panel, detail panel emergency buttons):
// the target is fixed at the press, confirmations open as a modal over whatever is open, and
// each pressed button gets sending / done / failed feedback from the message log.
import { useEffect, useState, type ReactNode } from 'react'
import type { LogEntry, VehicleCommand, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { requestConfirm } from './api'
import { ConfirmDialog } from './ConfirmDialog'
import { errorText } from './errorText'
import { clearPress, failPress, NO_FEEDBACK, press, settle, stateOf, type BtnState, type Feedback } from './feedback'
import { runCommand, type RunResult, type SendFn } from './useCommand'

export interface RunnerDeps {
  readonly send: SendFn
  readonly confirm: typeof requestConfirm
}

interface Args {
  readonly entries: readonly LogEntry[]
  readonly dict: Dict
  readonly vehicleOf: (sysid: number) => VehicleState | undefined
  /** A send that failed before reaching the vehicle (logged like a command result). */
  readonly onError: (sysid: number, command: VehicleCommand, message: string) => void
  readonly deps?: RunnerDeps
}

/** An AI proposal's press: the id goes with the send, the note into the confirm dialog. */
export interface PickOpts {
  readonly aiProposalId?: string
  readonly note?: string
  /** The final outcome: `queued`, `error`, or `needs_confirm` when the confirm dialog was cancelled. */
  readonly onResult?: (r: RunResult) => void
}

interface Pending {
  readonly sysid: number
  readonly command: VehicleCommand
  readonly message?: string
  readonly opts: PickOpts
}

export interface Runner {
  readonly pick: (sysid: number, command: VehicleCommand, opts?: PickOpts) => void
  readonly feedback: (sysid: number, cmd: string) => BtnState | null
  readonly sending: boolean
  /** The confirm modal, when one is open (render it once, anywhere). */
  readonly confirm: ReactNode
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export function useCommandRunner({ entries, dict, vehicleOf, onError, deps }: Args): Runner {
  const [pending, setPending] = useState<Pending | null>(null)
  const [sending, setSending] = useState(0)
  const [fb, setFb] = useState<Feedback>(NO_FEEDBACK)
  const now = useNow(fb.size > 0)
  useEffect(() => setFb((f) => settle(f, entries, Date.now())), [entries])

  const after = (sysid: number, command: VehicleCommand, r: RunResult, opts: PickOpts) => {
    if (r.kind === 'needs_confirm') {
      setFb((f) => clearPress(f, sysid, command.cmd))
      setPending({ sysid, command, message: r.message, opts })
      return
    }
    if (r.kind === 'error') {
      setFb((f) => failPress(f, sysid, command.cmd, Date.now()))
      onError(sysid, command, errorText(r.code, r.message, dict))
    }
    opts.onResult?.(r)
  }
  const pick = (sysid: number, command: VehicleCommand, opts: PickOpts = {}) => {
    setFb((f) => press(f, sysid, command.cmd, entries, Date.now()))
    setSending((n) => n + 1)
    void runCommand(sysid, command, undefined, deps?.send, { aiProposalId: opts.aiProposalId })
      .then((r) => after(sysid, command, r, opts))
      .finally(() => setSending((n) => n - 1))
  }
  const confirm = pending && (
    <ConfirmDialog
      sysid={pending.sysid}
      command={pending.command}
      message={pending.message}
      vehicleName={vehicleOf(pending.sysid)?.name ?? `#${pending.sysid}`}
      vehicle={vehicleOf(pending.sysid)}
      dict={dict}
      deps={deps}
      aiProposalId={pending.opts.aiProposalId}
      note={pending.opts.note}
      onCancel={() => {
        setPending(null)
        pending.opts.onResult?.({ kind: 'needs_confirm' })
      }}
      onDone={(r) => {
        setPending(null)
        if (r.kind === 'queued') setFb((f) => press(f, pending.sysid, pending.command.cmd, entries, Date.now()))
        after(pending.sysid, pending.command, r, pending.opts)
      }}
    />
  )
  return { pick, feedback: (sysid, cmd) => stateOf(fb, sysid, cmd, now), sending: sending > 0, confirm }
}
