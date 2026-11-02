// zod schemas mirroring the server's limits (logbook_api / flight_api validation).
import { z } from 'zod'

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const optionalDate = z.union([z.literal(''), dateString])
const short = z.string().max(120)
const name = z.string().min(1).max(60)
const long = z.string().max(2000)

export const resultValue = z.enum(['ok', 'ng', 'skipped'])

export function inspectionRunSchemaFor(itemCount: number) {
  return z.object({
    template_id: z.number().int(),
    place: z.string().max(200),
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    performed_on: dateString,
    inspector: name,
    notes: long,
    results: z
      .array(z.object({ position: z.number().int().min(1), result: resultValue, remark: z.string().max(200) }))
      .length(itemCount),
    supersedes: z.number().int().nullable(),
  })
}

export const squawkSchema = z.object({
  occurred_on: dateString,
  description: z.string().min(1).max(2000),
  action_on: optionalDate,
  action: long,
  confirmer: z.string().max(60),
})

export const flightPatchSchema = z
  .object({
    pilot: z.string().max(60).optional(),
    pilot_license: z.string().max(60).optional(),
    takeoff_at: z.number().int().nonnegative().optional(),
    landed_at: z.number().int().nonnegative().optional(),
    takeoff_place: long.optional(),
    landing_place: long.optional(),
    purposes: z.array(z.string().max(60)).max(20).optional(),
    specific_flight: z.array(z.string().max(60)).max(20).optional(),
    summary: long.optional(),
    safety_notes: long.optional(),
    status: z.enum(['draft', 'confirmed']).optional(),
  })
  .refine((p) => p.takeoff_at === undefined || p.landed_at === undefined || p.landed_at >= p.takeoff_at, {
    message: 'landed_at < takeoff_at',
    path: ['landed_at'],
  })

export const maintenanceSchema = z.object({
  performed_on: dateString,
  detail: z.string().min(1).max(2000),
  reason: z.string().max(500),
  place: z.string().max(500),
  engineer: z.string().max(500),
  notes: z.string().max(500),
  supersedes: z.number().int().nullable(),
})

export const registrySchema = z.object({
  name: short.min(1),
  registration: short,
  uas_type: short,
  model: short,
  type_cert_no: short,
  airworthiness_class: short,
  airworthiness_no: short,
  manufacturer: short,
  serial_no: short,
  initial_flight_minutes: z.number().int().min(0).max(10_000_000),
  inspection_template_id: z.number().int().nullable(),
  endurance_minutes: z.number().int().min(0).max(10_000_000).nullable(),
})

export const pilotSchema = z.object({ full_name: short, license_no: short })

export const templateSchema = z.object({
  name: name,
  items: z.array(z.object({ label: name, detail: z.string().max(200) })).min(1).max(50),
})

export interface Issue {
  readonly path: string
  readonly message: string
}

type ParseLike = { readonly success: true } | { readonly success: false; readonly error: { readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[] } }

export function firstIssue(r: ParseLike): Issue | null {
  if (r.success) return null
  const issue = r.error.issues[0]
  return issue ? { path: issue.path.map(String).join('.'), message: issue.message } : null
}
