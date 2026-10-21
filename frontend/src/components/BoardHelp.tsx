// 보드 위 표시(화살표·숫자·색·평가 막대) 도움말. 마우스를 올리면 보이고, 클릭하면 고정된다.
import { useEffect, useRef, useState } from 'react'
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
        aria-label="보드 표시 도움말"
        aria-expanded={open}
        onClick={() => setPinned(!pinned)}
      >
        ?
      </button>
      {open && (
        <div className="help-pop" role="dialog" aria-label="보드 표시 도움말">
          <h4>보드 표시 안내</h4>

          <section>
            <h5>화살표 = 이 포지션에서 실제로 둔 수</h5>
            <p>
              오른쪽 <b>내가 둔 수 / 상대들이 둔 수</b> 탭에 따라, 저장된 대국에서 이 포지션 다음에 둔 수를 보여줘요.
            </p>
            <div className="legend-row">
              <MiniArrow color={QUALITY_COLORS.good} width={2} />
              <MiniArrow color={QUALITY_COLORS.good} width={5} />
              <span>
                <b>굵을수록</b> 자주 둔 수예요.
              </span>
            </div>
            <div className="legend-row">
              <span className="legend-num">68</span>
              <span>
                가운데 숫자는 그 수를 둔 <b>비율(%)</b>이에요. 8% 이상인 수에만 표시해요.
              </span>
            </div>
          </section>

          <section>
            <h5>화살표 색 = 엔진 판정</h5>
            <ul className="legend-list">
              <li><MiniArrow color={QUALITY_COLORS.good} /> 최선·좋은 수</li>
              <li><MiniArrow color={QUALITY_COLORS.dubious} /> 부정확·실수</li>
              <li><MiniArrow color={QUALITY_COLORS.bad} /> 블런더</li>
              <li><MiniArrow color={QUALITY_COLORS.unknown} /> 아직 분석 전</li>
              <li><MiniArrow color={ENGINE_COLOR} dashed /> 엔진이 추천하는 최선 수</li>
            </ul>
            <p className="note">엔진 후보 줄에 마우스를 올리면 보라 점선이 그 수로 바뀌어요.</p>
          </section>

          <section>
            <h5>그 밖의 표시</h5>
            <ul className="legend-list plain">
              <li>
                <span className="legend-evalbar" aria-hidden />
                왼쪽 막대: 엔진 평가. 흰 부분이 클수록 백이 유리하고, 숫자는 폰 단위 차이예요(M3 = 3수 메이트).
              </li>
              <li>
                <span className="legend-check" aria-hidden />
                킹 칸의 붉은 빛: 체크 (진하면 체크메이트)
              </li>
            </ul>
            <p className="note">표의 수에 마우스를 올리면 화살표가 강조되고, 클릭하면 그 수를 둬요.</p>
          </section>
        </div>
      )}
    </div>
  )
}
