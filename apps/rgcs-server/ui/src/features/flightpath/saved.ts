// The vehicle's path parameters as last read, kept in this browser so a plan drawn while the
// vehicle is off still uses its own values (user decision 2026-10-20). A per-viewer convenience:
// storage may be empty or blocked, then the defaults apply.

const KEY = (sysid: number) => `rgcs.pathParams.${sysid}`

export type Values = Readonly<Record<string, number>>

export function mergeValues(saved: Values, fresh: Values): Values {
  return { ...saved, ...fresh }
}

export function loadSaved(sysid: number): Values {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY(sysid)) ?? '{}')
    if (typeof raw !== 'object' || raw === null) return {}
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])))
  } catch {
    return {}
  }
}

export function saveValues(sysid: number, values: Values): void {
  try {
    localStorage.setItem(KEY(sysid), JSON.stringify(values))
  } catch {
    // private window / blocked storage: the next visit uses the defaults
  }
}
