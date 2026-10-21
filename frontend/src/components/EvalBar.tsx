// 체스닷컴식 세로 평가 막대. 백이 유리할수록 흰 부분이 커진다.
import { useRef } from 'react'
import type { Color } from '../api/client'
import { winChance } from '../lib/eval'

interface Props {
  cp: number | null // 백 기준. null이면 아직 평가 없음
  mate: number | null
  orientation: Color
}

export function EvalBar({ cp, mate, orientation }: Props) {
  // 다음 포지션을 분석하는 동안에는 직전 평가를 유지해 막대가 가운데로 튀지 않게 한다.
  const last = useRef<{ cp: number; mate: number | null }>({ cp: 0, mate: null })
  if (cp !== null) last.current = { cp, mate }
  const ev = last.current

  const whiteShare =
    ev.mate !== null ? (ev.mate > 0 ? 1 : 0) : Math.min(0.97, Math.max(0.03, (1 + winChance(ev.cp)) / 2))
  const whiteAhead = ev.mate !== null ? ev.mate > 0 : ev.cp >= 0
  const label = ev.mate !== null ? `M${Math.abs(ev.mate)}` : Math.abs(ev.cp / 100).toFixed(1)

  // 보드 아래쪽이 백이면 흰 부분이 아래에서 차오른다.
  const whiteAtBottom = orientation === 'white'
  const labelAtBottom = whiteAhead === whiteAtBottom

  return (
    <div
      className={`eval-bar ${cp === null ? 'stale' : ''}`}
      role="meter"
      aria-label="엔진 평가"
      aria-valuetext={`${whiteAhead ? '백' : '흑'} 우세 ${label}`}
      title={`${whiteAhead ? '백' : '흑'} 우세 ${label}`}
    >
      <div
        className="eval-bar-white"
        style={{
          height: `${whiteShare * 100}%`,
          [whiteAtBottom ? 'bottom' : 'top']: 0,
        }}
      />
      <span
        className={`eval-bar-label ${whiteAhead ? 'on-white' : 'on-black'}`}
        style={{ [labelAtBottom ? 'bottom' : 'top']: 4 }}
      >
        {label}
      </span>
    </div>
  )
}
