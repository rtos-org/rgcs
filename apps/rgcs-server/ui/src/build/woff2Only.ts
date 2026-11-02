// Build plugin: Fontsource stylesheets list a .woff fallback after each .woff2. Every browser RGCS
// supports reads woff2, and the fallbacks would double the fonts in the binary (the UI is embedded).

/** The CSS without `, url(….woff) format('woff')` sources. */
export function stripWoff(css: string): string {
  return css.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '')
}

export function woff2Only() {
  return {
    name: 'rgcs-woff2-only',
    enforce: 'pre' as const,
    transform(code: string, id: string): { code: string; map: null } | null {
      return /[\\/]@fontsource[\\/][^?]*\.css(\?|$)/.test(id) ? { code: stripWoff(code), map: null } : null
    },
  }
}
