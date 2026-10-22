import { useState } from 'react'
import { getSoundOn, playMoveSound, preloadSounds, setSoundOn } from './lib/sound'
import { LANGS, useI18n, type Lang } from './i18n'
import { ExplorerPage } from './pages/ExplorerPage'

export function App() {
  const { t, lang, setLang } = useI18n()
  const [soundOn, setSoundOnState] = useState(getSoundOn)

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
        <span className="muted">{t('app.subtitle')}</span>
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
        <ExplorerPage />
      </main>
    </>
  )
}
