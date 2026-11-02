import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../styles/survey.css'), 'utf8')

describe('survey.css', () => {
  it('uses the Glass tokens, no hard-coded colours', () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })

  it('lifts the vertex and rotate handles above the waypoint badges', () => {
    expect(css).toMatch(/\.maplibregl-marker:has\(\.sv-vtx\),\s*\.maplibregl-marker:has\(\.sv-rot\)\s*\{\s*z-index:\s*4;\s*\}/)
  })
})
