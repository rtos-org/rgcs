// `.rgcsmission` (JSON, our own save format) and browser file helpers. `.waypoints` goes through the server.
import { z } from 'zod'
import type { Mission } from '../../shared/api/types'

const item = z.object({
  command: z.number().int().min(0).max(65535),
  frame: z.enum(['rel', 'abs', 'ter']),
  params: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number(),
  autocontinue: z.boolean(),
})

const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
const zone = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('polygon'), inclusion: z.boolean(), vertices: z.array(latLon).max(255) }),
  z.object({ kind: z.literal('circle'), inclusion: z.boolean(), center: latLon, radius: z.number() }),
])
const rallyPoint = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), alt: z.number() })

const missionSchema = z.object({
  name: z.string(),
  sysid: z.number().int().nullable(),
  default_alt: z.number(),
  default_frame: z.enum(['rel', 'abs', 'ter']),
  speed: z.number(),
  home: z.object({ lat: z.number(), lon: z.number(), alt: z.number() }).nullable(),
  items: z.array(item).max(700),
  // added 2026-10-19: older files have neither
  fence: z.array(zone).max(100).default([]),
  rally: z.array(rallyPoint).max(100).default([]),
  // added 2026-10-21: survey-grid blocks; older files have none
  surveys: z.array(z.object({ id: z.string(), first: z.number().int().min(0).max(100_000), count: z.number().int().min(0).max(100_000), spec: z.custom<unknown>(() => true) })).max(100).default([]),
})

const fileSchema = z.object({ format: z.literal('rgcsmission'), version: z.number().int(), mission: missionSchema })

export function serializeRgcsMission(m: Mission): string {
  const { id: _id, ...mission } = m
  return JSON.stringify({ format: 'rgcsmission', version: 1, mission }, null, 2)
}

/** Throws (zod / JSON error) on anything that is not a well-formed file. The id is never taken from a file. */
export function parseRgcsMission(text: string): Mission {
  const parsed = fileSchema.parse(JSON.parse(text))
  return { ...parsed.mission, id: null }
}

export function downloadText(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export const readFileText = (file: File): Promise<string> => file.text()

export const safeFileStem = (name: string): string => {
  const stem = name.replace(/[^A-Za-z0-9_-]/g, '')
  return stem === '' ? 'mission' : stem
}
