import { useState } from 'react'
import { getSoundSet, playMoveSound, preloadSounds, setSoundSet, SOUND_SETS, type SoundSet } from './lib/sound'
import { LANGS, useI18n, type Lang } from './i18n'
import { ExplorerPage } from './pages/ExplorerPage'

export function App() {
  const { t, lang, setLang } = useI18n()
  const [soundSet, setSoundSetState] = useState(getSoundSet)

  function changeSound(set: SoundSet) {
    setSoundSet(set)
    setSoundSetState(set)
    preloadSounds()
    playMoveSound('move') // 고른 소리를 한 번 들려준다.
  }

  return (
    <>
      <header className="app-header" onPointerDown={preloadSounds}>
        <h1 className="brand">
          <span className="brand-mark" aria-hidden>
            ♞
          </span>
          {t('app.name')}
        </h1>
        <span className="muted">{t('app.subtitle')}</span>
        <div className="header-controls">
          <label className="sound-select">
            {t('app.sound')}
            <select value={soundSet} onChange={(e) => changeSound(e.target.value as SoundSet)}>
              {SOUND_SETS.map((s) => (
                <option key={s} value={s}>
                  {t(`sound.${s}`)}
                </option>
              ))}
            </select>
          </label>
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
