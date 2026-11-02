import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'

const CSS = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true })

// The page loads nothing from another origin by itself: fonts and styles ship with RGCS, so the UI
// works offline on the vehicle LAN and no third party sees who opens it.
describe('self-hosted assets', () => {
  it('index_html_loads_no_external_stylesheet_or_script', () => {
    const external = [...indexHtml.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
    expect(external).toEqual([])
  })

  it('no_stylesheet_imports_from_another_origin', () => {
    const offenders = Object.entries(CSS).flatMap(([path, text]) => [...text.matchAll(/@import\s+url\(\s*["']?https?:|url\(\s*["']?https?:\/\/fonts\./g)].map(() => path))
    expect(Object.keys(CSS).length).toBeGreaterThan(5)
    expect(offenders).toEqual([])
  })

  it('the_ui_fonts_are_bundled', async () => {
    const main = (await import('../main.tsx?raw')).default as string
    expect(main).toMatch(/@fontsource\/ibm-plex-sans-jp/)
    expect(main).toMatch(/@fontsource\/ibm-plex-mono/)
  })
})
