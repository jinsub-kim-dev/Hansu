// 보드 위 표시(화살표·숫자·색·평가 막대) 도움말. 마우스를 올리면 보이고, 클릭하면 고정된다.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { QUALITY_COLORS } from '../lib/eval'

const ENGINE_COLOR = '#9b6bff' // MoveArrows의 엔진 최선 수 색과 같다

/** 범례용 작은 화살표 */
function MiniArrow({ color, width = 4, dashed = false }: { color: string; width?: number; dashed?: boolean }) {
  return (
    <svg className="mini-arrow" viewBox="0 0 40 16" aria-hidden>
      <line
        x1="3" y1="8" x2="28" y2="8"
        stroke={color} strokeWidth={width} strokeLinecap="round"
        strokeDasharray={dashed ? '5 4' : undefined}
      />
      <polygon points={`38,8 27,${8 - width - 2} 27,${8 + width + 2}`} fill={color} />
    </svg>
  )
}

export function BoardHelp() {
  const { t } = useI18n()
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const open = hover || pinned

  // 고정된 창은 바깥 클릭이나 Esc로 닫는다.
  useEffect(() => {
    if (!pinned) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setPinned(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPinned(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  return (
    <div
      className="board-help"
      ref={ref}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        className={pinned ? 'help-btn pinned' : 'help-btn'}
        aria-label={t('help.button')}
        aria-expanded={open}
        onClick={() => setPinned(!pinned)}
      >
        ?
      </button>
      {open && (
        <div className="help-pop" role="dialog" aria-label={t('help.button')}>
          <h4>{t('help.title')}</h4>

          <section>
            <h5>{t('help.arrows.title')}</h5>
            <p>{t('help.arrows.desc')}</p>
            <div className="legend-row">
              <MiniArrow color={QUALITY_COLORS.good} width={2} />
              <MiniArrow color={QUALITY_COLORS.good} width={5} />
              <span>{t('help.arrows.width')}</span>
            </div>
            <div className="legend-row">
              <span className="legend-num">68</span>
              <span>{t('help.arrows.number')}</span>
            </div>
          </section>

          <section>
            <h5>{t('help.colors.title')}</h5>
            <ul className="legend-list">
              <li><MiniArrow color={QUALITY_COLORS.good} /> {t('help.colors.good')}</li>
              <li><MiniArrow color={QUALITY_COLORS.dubious} /> {t('help.colors.dubious')}</li>
              <li><MiniArrow color={QUALITY_COLORS.bad} /> {t('help.colors.bad')}</li>
              <li><MiniArrow color={QUALITY_COLORS.unknown} /> {t('help.colors.unknown')}</li>
              <li><MiniArrow color={ENGINE_COLOR} dashed /> {t('help.colors.engine')}</li>
            </ul>
            <p className="note">{t('help.colors.note')}</p>
          </section>

          <section>
            <h5>{t('help.other.title')}</h5>
            <ul className="legend-list plain">
              <li>
                <span className="legend-evalbar" aria-hidden />
                {t('help.other.evalbar')}
              </li>
              <li>
                <span className="legend-check" aria-hidden />
                {t('help.other.check')}
              </li>
            </ul>
            <p className="note">{t('help.other.note')}</p>
          </section>
        </div>
      )}
    </div>
  )
}
