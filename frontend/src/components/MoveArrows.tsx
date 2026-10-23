// 수순 통계를 보드 위 화살표로 그린다. 많이 둔 수일수록 화살표가 굵고 진하다.
// react-chessboard의 기본 화살표는 화살표별 두께를 지원하지 않아 SVG로 직접 그린다.
import type { Color, MoveStat } from '../api/client'

const SQ = 100 // viewBox에서 한 칸의 크기
// 엔진 최선 수는 평가 색(초록/노랑/빨강)과 겹치지 않게 보라색 점선으로 그린다.
const BEST_COLOR = '#9b6bff'
const MAX_ARROWS = 8

function squareCenter(square: string, orientation: Color): [number, number] {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1
  const col = orientation === 'white' ? file : 7 - file
  const row = orientation === 'white' ? 7 - rank : rank
  return [col * SQ + SQ / 2, row * SQ + SQ / 2]
}

/** 화살표 좌표: 시작점, 화살촉 밑변 중심, 끝점, 날개 방향, 비율 표시 위치. */
function geometry(uci: string, orientation: Color, width: number) {
  const [x1, y1] = squareCenter(uci.slice(0, 2), orientation)
  const [x2, y2] = squareCenter(uci.slice(2, 4), orientation)
  const len = Math.hypot(x2 - x1, y2 - y1)
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len]
  const head = width * 1.9 + 8
  // 화살촉 끝은 도착 칸 중심보다 조금 앞에서 멈춘다.
  const tip: [number, number] = [x2 - ux * 18, y2 - uy * 18]
  const base: [number, number] = [tip[0] - ux * head, tip[1] - uy * head]
  const start: [number, number] = [x1 + ux * 22, y1 + uy * 22]
  const hw = width * 1.25 + 6
  return {
    tip,
    base,
    start,
    wing: [-uy * hw, ux * hw] as const,
    label: [start[0] + (base[0] - start[0]) * 0.55, start[1] + (base[1] - start[1]) * 0.55] as const,
  }
}

interface Props {
  moves: MoveStat[]
  total: number
  orientation: Color
  colorOf: (uci: string) => string // 수마다 화살표 색
  highlighted: string | null
  bestMove?: string | null // 엔진 최선 수 (uci)
  pinned?: { uci: string; color: string } | null // 복기 노트에 보관한 내 수: 통계·필터와 상관없이 흰 테두리로 그린다
  bold?: boolean // 작은 보드용: 최선 수·보관한 수 화살표를 굵게
}

export function MoveArrows({ moves, total, orientation, colorOf, highlighted, bestMove, pinned, bold }: Props) {
  if (total === 0 && !bestMove && !pinned) return null
  // 빈도 낮은 수를 먼저 그려 많이 둔 수가 위에 오게 한다. 강조된 수는 맨 위.
  const shown = (total ? moves : [])
    .slice(0, MAX_ARROWS)
    .reverse()
    .sort((a, b) => Number(a.uci === highlighted) - Number(b.uci === highlighted))

  const arrows = shown.map((m) => {
    const share = m.games / total
    const isHi = m.uci === highlighted
    const width = 7 + 23 * share + (isHi ? 4 : 0)
    return {
      m,
      share,
      isHi,
      width,
      ...geometry(m.uci, orientation, width),
      opacity: isHi ? 0.95 : highlighted ? 0.25 : 0.35 + 0.5 * share,
    }
  })
  const bestW = bold ? 14 : 6
  const pinW = bold ? 22 : 12
  const best = bestMove ? { width: bestW, ...geometry(bestMove, orientation, bestW) } : null
  const pin = pinned ? { color: pinned.color, width: pinW, ...geometry(pinned.uci, orientation, pinW) } : null

  return (
    <svg className="move-arrows" viewBox={`0 0 ${8 * SQ} ${8 * SQ}`} aria-hidden>
      {arrows.map(({ m, width, tip, base, start, wing, opacity }) => (
        <g key={m.uci} opacity={opacity}>
          <line
            x1={start[0]} y1={start[1]} x2={base[0]} y2={base[1]}
            stroke={colorOf(m.uci)} strokeWidth={width} strokeLinecap="round"
          />
          <polygon
            points={`${tip[0]},${tip[1]} ${base[0] + wing[0]},${base[1] + wing[1]} ${base[0] - wing[0]},${base[1] - wing[1]}`}
            fill={colorOf(m.uci)}
          />
        </g>
      ))}
      {best && (
        <g opacity={0.95}>
          <line
            x1={best.start[0]} y1={best.start[1]} x2={best.base[0]} y2={best.base[1]}
            stroke={BEST_COLOR} strokeWidth={best.width} strokeLinecap="round" strokeDasharray={bold ? "26 24" : "14 10"}
          />
          <polygon
            points={`${best.tip[0]},${best.tip[1]} ${best.base[0] + best.wing[0]},${best.base[1] + best.wing[1]} ${best.base[0] - best.wing[0]},${best.base[1] - best.wing[1]}`}
            fill={BEST_COLOR}
          />
        </g>
      )}
      {/* 비율(%) 표시는 화살표와 따로 그려 흐려지지 않게 한다. */}
      {arrows
        .filter((a) => a.share >= 0.08 || a.isHi)
        .map(({ m, label, share, isHi }) => (
          <g key={m.uci} opacity={highlighted && !isHi ? 0.45 : 1}>
            <circle cx={label[0]} cy={label[1]} r={17} fill="#fff" stroke={colorOf(m.uci)} strokeWidth={3} />
            <text x={label[0]} y={label[1]} className="arrow-label">
              {Math.round(share * 100)}
            </text>
          </g>
        ))}
      {/* 보관한 내 수는 다른 화살표의 비율 표시에 가리지 않게 맨 위에 그린다. */}
      {pin && (
        <g opacity={0.95}>
          <line
            x1={pin.start[0]} y1={pin.start[1]} x2={pin.base[0]} y2={pin.base[1]}
            stroke="#fff" strokeWidth={pin.width + 6} strokeLinecap="round"
          />
          <polygon
            points={`${pin.tip[0]},${pin.tip[1]} ${pin.base[0] + pin.wing[0]},${pin.base[1] + pin.wing[1]} ${pin.base[0] - pin.wing[0]},${pin.base[1] - pin.wing[1]}`}
            fill={pin.color} stroke="#fff" strokeWidth={4} strokeLinejoin="round"
          />
          <line
            x1={pin.start[0]} y1={pin.start[1]} x2={pin.base[0]} y2={pin.base[1]}
            stroke={pin.color} strokeWidth={pin.width} strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  )
}
