import { useEffect, useState } from 'react'
import { getGame, type GameSummary, type Review } from './api/client'
import { getSoundOn, playMoveSound, preloadSounds, setSoundOn } from './lib/sound'
import { LANGS, useI18n, type Lang } from './i18n'
import { ExplorerPage, type OpenRequest } from './pages/ExplorerPage'
import { GamesPage } from './pages/GamesPage'
import { ReviewsPage } from './pages/ReviewsPage'

type View = 'explore' | 'games' | 'reviews'
const VIEWS: View[] = ['explore', 'games', 'reviews']

// 탭 아이콘(24×24 기준 경로): 탐색 = 보드, 대국 = 목록, 복기 노트 = 책갈피
const VIEW_ICONS: Record<View, string> = {
  explore: 'M4 4h16v16H4zM4 12h16M12 4v16M4 4h8v8H4zM12 12h8v8h-8z',
  games: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  reviews: 'M6 3h12v18l-6-4-6 4z',
}

// 화면은 주소의 #으로 기억해 새로고침·뒤로 가기에도 유지한다.
const viewFromHash = (): View => VIEWS.find((v) => v !== 'explore' && window.location.hash === `#/${v}`) ?? 'explore'

export function App() {
  const { t, lang, setLang } = useI18n()
  const [soundOn, setSoundOnState] = useState(getSoundOn)
  const [view, setView] = useState<View>(viewFromHash)
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null)
  const [reviewsVersion, setReviewsVersion] = useState(0)

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function go(next: View) {
    window.location.hash = next === 'explore' ? '' : `#/${next}`
    setView(next)
    // 노트 화면에서 돌아오면 탐색 화면의 복기 노트 패널을 다시 읽는다.
    if (next === 'explore') setReviewsVersion((v) => v + 1)
  }

  function openReview(review: Review) {
    setOpenRequest({ review, nonce: Date.now() })
    go('explore')
  }

  async function openGame(summary: GameSummary) {
    try {
      setOpenRequest({ game: await getGame(summary.id), nonce: Date.now() })
      go('explore')
    } catch (e) {
      window.alert((e as Error).message)
    }
  }

  function toggleSound() {
    const on = !soundOn
    setSoundOn(on)
    setSoundOnState(on)
    if (on) {
      preloadSounds()
      playMoveSound('move') // 켰다는 것을 한 번 들려준다.
    }
  }

  return (
    <>
      <header className="app-header" onPointerDown={preloadSounds}>
        <h1 className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden />
          {t('app.name')}
        </h1>
        <nav className="app-nav" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? 'active' : ''}
              onClick={() => go(v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d={VIEW_ICONS[v]} />
              </svg>
              {t(`nav.${v}`)}
            </button>
          ))}
        </nav>
        <div className="header-controls">
          <button
            type="button"
            role="switch"
            aria-checked={soundOn}
            className="sound-toggle"
            onClick={toggleSound}
            title={soundOn ? t('sound.turnOff') : t('sound.turnOn')}
          >
            {t('app.sound')}
            <span className="switch" aria-hidden />
          </button>
          <label className="sound-select">
            {t('app.language')}
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main onPointerDown={preloadSounds}>
        <div hidden={view !== 'explore'}>
          <ExplorerPage active={view === 'explore'} openRequest={openRequest} reviewsVersion={reviewsVersion} />
        </div>
        {view === 'games' && <GamesPage active onOpen={openGame} />}
        {view === 'reviews' && <ReviewsPage active onOpen={openReview} />}
      </main>
    </>
  )
}
