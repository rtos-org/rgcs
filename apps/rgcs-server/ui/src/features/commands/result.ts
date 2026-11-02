import type { CommandResult, SysId, VehicleCommand } from '../../shared/api/types'

/** A failure that never reached the server (negative id); an `other` command keeps its MAV_CMD for the label. */
export function localResult(sysid: SysId, command: VehicleCommand, reason: string, now: number = Date.now()): CommandResult {
  const base = { id: -now, sysid, cmd: command.cmd, ok: false, reason, ts: now }
  return command.cmd === 'other' ? { ...base, mav_cmd: command.args.mav_cmd } : base
}
