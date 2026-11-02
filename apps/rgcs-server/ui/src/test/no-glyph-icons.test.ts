import { describe, expect, it } from 'vitest'

// Lucide icons only; text glyphs must not stand in for icons.
const GLYPHS = ['▶', '▲', '▼', '↔', '↕', '⌂', '◎', '✓', '✕', '⚠', '↗', '❚❚', '⤓', '⇅', '◔', '🔒', '🔓', '▣', '•••']

const SOURCES = import.meta.glob<string>('../**/*.tsx', { query: '?raw', import: 'default', eager: true })

describe('icons', () => {
  it('no_text_glyph_icons', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.tsx'))
      .flatMap(([path, text]) => {
        const hits = GLYPHS.filter((g) => text.includes(g))
        // A lone "×" between tags is a close button drawn with a glyph.
        if (/>\s*×\s*</.test(text)) hits.push('×')
        return hits.map((g) => `${path}: ${g}`)
      })
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })
})
