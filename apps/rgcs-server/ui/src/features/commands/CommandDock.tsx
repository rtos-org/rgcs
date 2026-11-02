// The 全コマンド panel as an operator tool (user request 2026-10-19): it stays open across
// commands until closed, always targets the selected vehicle, and confirmations appear as a
// modal over it instead of replacing it.
import type { LogEntry, VehicleState } from '../../shared/api/types'
import { hhmmss } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { entryText } from '../log/format'
import { CommandsSheet } from './CommandsSheet'
import { prearmReasons } from './prearm'
import type { Runner } from './useCommandRunner'

interface Props {
  readonly vehicle: VehicleState
  /** The message log, newest first: the panel shows the target vehicle's last command result. */
  readonly entries: readonly LogEntry[]
  readonly dict: Dict
  readonly beside?: boolean
  readonly onClose: () => void
  readonly onOpenGuided: (sysid: number) => void
  /** カメラ・ジンバル: the camera settings sheet. */
  readonly onOpenCamera?: (sysid: number) => void
  /** Sends, confirms and per-button feedback (shared with the detail panel). */
  readonly runner: Runner
}

function LastResult({ sysid, entries, sending, dict }: { sysid: number; entries: readonly LogEntry[]; sending: boolean; dict: Dict }) {
  const last = entries.find((e) => e.sysid === sysid && e.source === 'command')
  return (
    <div className="cmd-last t2" data-testid="cmd-last" aria-live="polite">
      {sending ? (
        <span className="t3">{dict.cmdSending}</span>
      ) : last ? (
        <span className={last.severity === 'error' ? 'bad' : ''}>
          <span className="num t3">{hhmmss(last.ts)}</span> {entryText(last, dict)}
        </span>
      ) : (
        <span className="t3">{dict.cmdNoResult}</span>
      )}
    </div>
  )
}

export function CommandDock({ vehicle, entries, dict, beside = false, onClose, onOpenGuided, onOpenCamera, runner }: Props) {
  return (
    <CommandsSheet
      vehicle={vehicle}
      dict={dict}
      beside={beside}
      onClose={onClose}
      onOpen={(target) => (target === 'guided' ? onOpenGuided(vehicle.sysid) : onOpenCamera?.(vehicle.sysid))}
      // The target is fixed when the button is pressed, even if the selection changes meanwhile.
      onPick={(command) => runner.pick(vehicle.sysid, command)}
      feedback={(cmd) => runner.feedback(vehicle.sysid, cmd)}
      prearm={prearmReasons(entries, vehicle.sysid, Date.now())}
      footer={<LastResult sysid={vehicle.sysid} entries={entries} sending={runner.sending} dict={dict} />}
    />
  )
}
