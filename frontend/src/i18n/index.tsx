// 다국어(한국어/영어). 문구는 ko.ts / en.ts에 모아 두고, t(키, 값)으로 꺼내 쓴다.
// 고른 언어는 이 브라우저에 기억하고, 처음에는 브라우저 언어를 따른다.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en } from './en'
import { ko, type MessageKey, type Msg, type Params } from './ko'

export type Lang = 'ko' | 'en'
export type { MessageKey }

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
]

const DICTS: Record<Lang, Record<MessageKey, Msg>> = { ko, en }
const LANG_KEY = 'chess-review:lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'ko' || saved === 'en') return saved
  } catch {
    // 저장소를 못 쓰면 브라우저 언어를 따른다.
  }
  return navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

// React 밖(API 요청 헤더, 입력 해석 오류 등)에서도 현재 언어를 쓸 수 있게 둔다.
let currentLang: Lang = initialLang()

export function getLang(): Lang {
  return currentLang
}

export function translate(key: MessageKey, params: Params = {}, lang: Lang = currentLang): string {
  const msg = DICTS[lang][key] ?? ko[key]
  if (typeof msg === 'function') return msg(params)
  return msg.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MessageKey, params?: Params) => string
  locale: string
  /** ISO 시각 → 현지 날짜 */
  formatDate: (iso: string | null) => string
  formatNumber: (n: number) => string
}

const I18nContext = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang)

  const setLang = useCallback((next: Lang) => {
    currentLang = next
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      // 기억하지 못해도 이번 화면에는 적용된다.
    }
    setLangState(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = translate('app.title', {}, lang)
  }, [lang])

  const value = useMemo<I18n>(() => {
    const locale = lang === 'ko' ? 'ko-KR' : 'en-US'
    return {
      lang,
      setLang,
      t: (key, params) => translate(key, params, lang),
      locale,
      formatDate: (iso) => (iso ? new Date(iso).toLocaleDateString(locale) : '-'),
      formatNumber: (n) => n.toLocaleString(locale),
    }
  }, [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n은 I18nProvider 안에서만 쓸 수 있습니다.')
  return ctx
}
