import { describe, expect, it } from 'vitest'
import { stripWoff, woff2Only } from './woff2Only'

const FACE = `@font-face {
  font-family: 'IBM Plex Sans JP';
  src: url(./files/ibm-plex-sans-jp-0-400-normal.woff2) format('woff2'), url(./files/ibm-plex-sans-jp-0-400-normal.woff) format('woff');
}`

describe('woff2 only', () => {
  it('drops_the_woff_fallback_and_keeps_the_woff2_source', () => {
    expect(stripWoff(FACE)).toContain("src: url(./files/ibm-plex-sans-jp-0-400-normal.woff2) format('woff2');")
    expect(stripWoff(FACE)).not.toContain('.woff)')
  })

  it('touches_only_fontsource_stylesheets', () => {
    const t = woff2Only().transform
    expect(t(FACE, '/x/node_modules/@fontsource/ibm-plex-sans-jp/400.css')).toEqual({ code: stripWoff(FACE), map: null })
    expect(t(FACE, '/x/src/styles/app.css')).toBeNull()
    expect(t(FACE, '/x/node_modules/@fontsource/ibm-plex-mono/index.js')).toBeNull()
  })
})
