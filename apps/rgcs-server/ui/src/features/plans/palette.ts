// Row colours of the open plans (spec 2026-10-20 §9): eight vivid hues about 45° apart that read on
// dark satellite and OSM maps. A new row takes the unused colour farthest in hue from the colours
// in use and from the amber selection highlight, so the orange (closest to amber) comes last.

/** In the order an empty planner hands them out. */
export const PALETTE: readonly string[] = ['#3d9eff', '#31d848', '#d76afb', '#ff4d79', '#0bdabe', '#b6e723', '#9c7aff', '#ff9429']

/** `--caution`, the selection highlight: no row colour should be mistaken for it. */
const SELECTION = '#f2b544'

/** HSL hue in degrees of '#rrggbb' (0 for a grey or an unreadable value). */
export function hueOf(hex: string): number {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  if (!Number.isFinite(n)) return 0
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** The unused palette colour whose nearest hue among `used` (and the selection amber) is farthest. */
export function nextColor(used: readonly string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()))
  const free = PALETTE.filter((c) => !taken.has(c))
  if (free.length === 0) return PALETTE[used.length % PALETTE.length]!
  const hues = [...used, SELECTION].map(hueOf)
  const score = (c: string) => Math.min(...hues.map((h) => hueDistance(h, hueOf(c))))
  // ties keep the palette order
  return free.reduce((best, c) => (score(c) > score(best) ? c : best))
}
