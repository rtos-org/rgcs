import { describe, expect, it } from 'vitest'
import { flightPatchSchema, inspectionRunSchemaFor, maintenanceSchema, registrySchema, squawkSchema, templateSchema } from './schema'

const results = (n: number) => Array.from({ length: n }, (_, i) => ({ position: i + 1, result: 'ok' as const, remark: '' }))

describe('logbook schemas', () => {
  it('inspection_run_requires_one_result_per_item', () => {
    const base = { template_id: 1, place: 'x', lat: null, lon: null, performed_on: '2026-12-05', inspector: 'admin', notes: '', supersedes: null }
    expect(inspectionRunSchemaFor(9).safeParse({ ...base, results: results(9) }).success).toBe(true)
    expect(inspectionRunSchemaFor(9).safeParse({ ...base, results: results(8) }).success).toBe(false)
    expect(inspectionRunSchemaFor(9).safeParse({ ...base, performed_on: '2026/12/05', results: results(9) }).success).toBe(false)
    expect(inspectionRunSchemaFor(9).safeParse({ ...base, inspector: '', results: results(9) }).success).toBe(false)
  })

  it('squawk_requires_a_date_and_a_description', () => {
    expect(squawkSchema.safeParse({ occurred_on: '', description: 'x', action_on: '', action: '', confirmer: '' }).success).toBe(false)
    expect(squawkSchema.safeParse({ occurred_on: '2026-12-05', description: '', action_on: '', action: '', confirmer: '' }).success).toBe(false)
    expect(squawkSchema.safeParse({ occurred_on: '2026-12-05', description: 'x', action_on: '', action: '', confirmer: '' }).success).toBe(true)
  })

  it('flight_patch_refuses_landing_before_takeoff', () => {
    expect(flightPatchSchema.safeParse({ takeoff_at: 10, landed_at: 5 }).success).toBe(false)
    expect(flightPatchSchema.safeParse({ summary: 'ok' }).success).toBe(true)
  })

  it('maintenance_registry_and_template_limits', () => {
    expect(maintenanceSchema.safeParse({ performed_on: '2026-12-10', detail: '', reason: '', place: '', engineer: '', notes: '', supersedes: null }).success).toBe(false)
    expect(registrySchema.safeParse({ name: 'UAV-01', registration: '', uas_type: '', model: '', type_cert_no: '', airworthiness_class: '', airworthiness_no: '', manufacturer: '', serial_no: '', initial_flight_minutes: -1, inspection_template_id: null, endurance_minutes: null }).success).toBe(false)
    expect(templateSchema.safeParse({ name: 'x', items: [] }).success).toBe(false)
    expect(templateSchema.safeParse({ name: 'x', items: [{ label: 'a', detail: '' }] }).success).toBe(true)
  })

  it('registry_endurance_is_null_or_a_non_negative_integer', () => {
    const base = { name: 'UAV-01', registration: '', uas_type: '', model: '', type_cert_no: '', airworthiness_class: '', airworthiness_no: '', manufacturer: '', serial_no: '', initial_flight_minutes: 0, inspection_template_id: null }
    expect(registrySchema.safeParse({ ...base, endurance_minutes: null }).success).toBe(true)
    expect(registrySchema.safeParse({ ...base, endurance_minutes: 25 }).success).toBe(true)
    expect(registrySchema.safeParse({ ...base, endurance_minutes: -1 }).success).toBe(false)
  })
})
