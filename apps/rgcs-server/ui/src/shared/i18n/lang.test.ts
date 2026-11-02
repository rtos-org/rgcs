import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLang, writeLang, detectLang, LANG_KEY, LANGS } from './lang'
import { dictionaries } from './index'
import { aiEn, aiJa } from './ai'
import { zhStrings } from './zh'
import { koStrings } from './ko'

describe('language persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('without a stored pick, follows the browser language and falls back to English', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'ja-JP'], language: 'fr-FR' })
    expect(readLang()).toBe('ja')
    localStorage.setItem(LANG_KEY, 'fr')
    expect(readLang()).toBe('ja')
    vi.stubGlobal('navigator', { languages: ['de-DE'], language: 'de-DE' })
    expect(readLang()).toBe('en')
  })

  it('maps browser tags to the supported languages', () => {
    expect(detectLang(['zh-TW'])).toBe('zh')
    expect(detectLang(['ko-KR', 'en'])).toBe('ko')
    expect(detectLang(['en-GB'])).toBe('en')
    expect(detectLang([])).toBe('en')
    expect(LANGS).toEqual(['en', 'ja', 'zh', 'ko'])
  })

  it('round-trips through localStorage', () => {
    writeLang('en')
    expect(localStorage.getItem(LANG_KEY)).toBe('en')
    expect(readLang()).toBe('en')
  })

  it('survives a throwing storage', () => {
    vi.stubGlobal('navigator', { languages: [] })
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readLang()).toBe('en')
    expect(() => writeLang('en')).not.toThrow()
  })
})

describe('dictionaries', () => {
  it('every language carries the same non-empty keys', () => {
    const ja = Object.keys(dictionaries.ja).sort()
    for (const lang of LANGS) {
      expect(Object.keys(dictionaries[lang]).sort(), lang).toEqual(ja)
      for (const k of ja) expect(dictionaries[lang][k as keyof typeof dictionaries.ja], `${lang}.${k}`).not.toBe('')
    }
  })

  it('zh and ko translate every key (no English fallback left)', () => {
    const ja = Object.keys(dictionaries.ja).sort()
    expect(Object.keys(zhStrings).sort()).toEqual(ja)
    expect(Object.keys(koStrings).sort()).toEqual(ja)
  })

  it('carries the network view strings', () => {
    expect(dictionaries.ja).toMatchObject({ netTitle: 'ネットワーク', netLoadFailed: 'ネットワーク情報を取得できません', netUnconfigured: '未構成' })
    expect(dictionaries.en).toHaveProperty('netLoadFailed')
  })

  it('carries the AI chat strings in both languages', () => {
    for (const k of Object.keys(aiJa)) expect(aiEn, k).toHaveProperty(k)
    expect(dictionaries.ja).toMatchObject({ aiTitle: 'AI', aiTarget: '対象', aiThinking: '考えています…', aiUnconfigured: 'AI チャットは未設定です。管理者がサーバーの config.toml ([ai]) を設定すると使えます。', aiAgo: '{n} 秒前' })
    expect(dictionaries.en).toHaveProperty('aiProposalLabel')
  })
})
