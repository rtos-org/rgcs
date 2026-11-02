/** One field of a MAVLink message (serde form: enums `{type}`, bitflags `{bits}`, byte arrays). */
export function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length > 16 ? `[${value.slice(0, 16).join(', ')}, … ${value.length}]` : `[${value.join(', ')}]`
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.type === 'string' && Object.keys(o).length === 1) return o.type
    if ('bits' in o && Object.keys(o).length === 1) return String(o.bits)
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && !Number.isInteger(value)) return String(Math.round(value * 1e6) / 1e6)
  return String(value)
}
