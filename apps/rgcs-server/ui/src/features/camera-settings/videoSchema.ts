import { z } from 'zod'
import type { CameraCommand, CameraProfile, CameraState } from '../../shared/api/types'

/** Encoding presets (prototype `ENC_PRESETS`). */
export const ENCODING_IDS = ['h264_720p', 'h264_1080p', 'h264_4k', 'h265_1080p', 'h265_4k'] as const

/** Thermal palettes (prototype `PALETTES`); id 1 does not exist on the MT11. */
export const PALETTES: readonly { readonly id: number; readonly label: string }[] = [
  { id: 0, label: 'White Hot' },
  { id: 2, label: 'Sepia' },
  { id: 3, label: 'Ironbow' },
  { id: 4, label: 'Rainbow' },
  { id: 5, label: 'Night' },
  { id: 6, label: 'Aurora' },
  { id: 7, label: 'Red Hot' },
  { id: 8, label: 'Jungle' },
  { id: 9, label: 'Medical' },
  { id: 10, label: 'Black Hot' },
  { id: 11, label: 'Glory Hot' },
]

export const AI_BOX_MIN = 32
export const AI_BOX_MAX = 600

const paletteIds = new Set(PALETTES.map((p) => p.id))

/** The 映像 tab: stored profile fields plus the live gain (not stored). */
export const videoSchema = z.object({
  encoding_preset: z.enum(ENCODING_IDS),
  thermal_palette: z.number().int().refine((n) => paletteIds.has(n), 'palette'),
  thermal_overlay: z.boolean(),
  ai_box_px: z.number().int().min(AI_BOX_MIN).max(AI_BOX_MAX),
  auto_record: z.boolean(),
  gain: z.enum(['high', 'low']).nullable(),
})

export type VideoDraft = z.infer<typeof videoSchema>

const isEncodingId = (id: string): id is VideoDraft['encoding_preset'] => (ENCODING_IDS as readonly string[]).includes(id)

export function startVideoDraft(p: CameraProfile, s: CameraState | undefined): VideoDraft {
  return {
    encoding_preset: isEncodingId(p.encoding_preset) ? p.encoding_preset : 'h264_1080p',
    thermal_palette: p.thermal_palette,
    thermal_overlay: p.thermal_overlay,
    ai_box_px: p.ai_box_px,
    auto_record: p.auto_record,
    gain: s?.thermal?.gain ?? null,
  }
}

const STORED = ['encoding_preset', 'thermal_palette', 'thermal_overlay', 'ai_box_px', 'auto_record'] as const

/** Profile patch (stored fields that changed) + camera commands for the live values. */
export function videoSteps(
  p: CameraProfile,
  s: CameraState | undefined,
  d: VideoDraft,
  connectionChanged: boolean,
): { readonly patch: Partial<CameraProfile> | null; readonly commands: readonly CameraCommand[] } {
  const changed = STORED.filter((k) => p[k] !== d[k])
  const patch = changed.length === 0 ? null : (Object.fromEntries(changed.map((k) => [k, d[k]])) as Partial<CameraProfile>)
  if (connectionChanged) return { patch, commands: [] }
  const commands: CameraCommand[] = [
    ...(changed.includes('encoding_preset') ? [{ cmd: 'encoding', args: { preset: d.encoding_preset } } as const] : []),
    ...(changed.includes('thermal_palette') ? [{ cmd: 'thermal_palette', args: { palette: d.thermal_palette } } as const] : []),
    ...(d.gain !== null && d.gain !== (s?.thermal?.gain ?? null) ? [{ cmd: 'thermal_gain', args: { gain: d.gain } } as const] : []),
  ]
  return { patch, commands }
}
