// The second line of a validation finding: which param ArduPilot would not keep, and what it
// would read back (`param_ignored`, from rgcs-core's `ignored_param_findings`).
import type { Finding, MissionItem } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { cmdKeyOf, fieldsOf } from './cmds'
import { fieldLabel, shortNum, wpLabel } from './labels'

function paramName(it: MissionItem | undefined, index: number, dict: Dict): string {
  const key = it ? cmdKeyOf(it.command) : null
  const field = key ? fieldsOf(key, null).find((f) => f.p === index) : undefined
  const param = field ? fieldLabel(field.key, dict) : dict.fParamN.replace('{n}', String(index))
  return key ? dict.fParamOf.replace('{cmd}', wpLabel(key, dict)).replace('{param}', param) : param
}

/** `null` when the finding carries no param detail. */
export function findingDetail(f: Finding, items: readonly MissionItem[], dict: Dict): string | null {
  if (!f.param) return null
  const { index, sent, stored } = f.param
  const it = f.seq !== null ? items[f.seq - 1] : undefined
  const text = stored === 0 ? dict.fParamDropped : dict.fParamChanged
  return text.replace('{what}', paramName(it, index, dict)).replace('{sent}', shortNum(sent)).replace('{stored}', shortNum(stored))
}
