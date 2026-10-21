import { useState } from 'react'
import { getSoundSet, playMoveSound, preloadSounds, setSoundSet, SOUND_SETS, type SoundSet } from './lib/sound'
import { ExplorerPage } from './pages/ExplorerPage'

export function App() {
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
          한수
        </h1>
        <span className="muted">체스 복기 · 포지션별 수순 통계</span>
        <label className="sound-select">
          착수음
          <select value={soundSet} onChange={(e) => changeSound(e.target.value as SoundSet)}>
            {SOUND_SETS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main onPointerDown={preloadSounds}>
        <ExplorerPage />
      </main>
    </>
  )
}
