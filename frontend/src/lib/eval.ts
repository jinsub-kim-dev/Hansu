import { translate } from '../i18n'

export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export interface CandidateLine {
  uci: string
  san: string
  cp: number // 백 기준
  mate: number | null
  pv_san: string[]
}

export interface EngineLine {
  best_uci: string | null
  best_san: string | null
  cp: number // 백 기준
  mate: number | null // 백 기준
  pv_san: string[]
  lines: CandidateLine[] // 엔진 후보 수 (좋은 순)
}

export interface MoveEval {
  uci: string
  san: string
  cp: number // 수를 둔 뒤 백 기준
  mate: number | null
  cp_loss: number | null
  win_chance_loss: number | null
  classification: Classification | null
}

/** 포지션 평가(브라우저에서 계산, usePositionEval). */
export interface PositionEval {
  status: 'done' | 'pending' | 'failed' | 'unavailable'
  message: string | null
  depth: number | null
  source: 'cloud' | 'local' | null // Lichess 클라우드 평가 / 브라우저 Stockfish
  position: EngineLine | null
  moves: MoveEval[]
}

/** centipawn → [-1, 1] 기대 승률 (Lichess와 같은 식). */
export function winChance(cp: number): number {
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
}

/** 승률 손실(0~1)과 판정. 점수는 둘 다 수를 두는 쪽 기준. */
export function classify(bestCp: number, moveCp: number, isBest: boolean): { loss: number; classification: Classification } {
  const loss = Math.max(0, winChance(bestCp) - winChance(moveCp)) / 2
  const classification: Classification =
    isBest || loss < 0.01 ? 'best' : loss < 0.05 ? 'good' : loss < 0.1 ? 'inaccuracy' : loss < 0.15 ? 'mistake' : 'blunder'
  return { loss, classification }
}

/** 백 기준 평가를 "+0.35" / "#3" / "#-2" 형식으로. */
export function formatEval(cp: number, mate: number | null): string {
  if (mate !== null) return `#${mate}`
  const v = cp / 100
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
}

export const CLASSIFICATION: Record<Classification, { symbol: string; className: string }> = {
  best: { symbol: '★', className: 'cls-best' },
  good: { symbol: '✓', className: 'cls-good' },
  inaccuracy: { symbol: '?!', className: 'cls-inaccuracy' },
  mistake: { symbol: '?', className: 'cls-mistake' },
  blunder: { symbol: '??', className: 'cls-blunder' },
}

/** 판정 이름(현재 언어) */
export function classificationLabel(c: Classification): string {
  return translate(`cls.${c}`)
}

// 보드 화살표와 표의 색 표시: 좋은 수는 초록, 이상한 수는 노랑, 블런더는 빨강.
export const QUALITY_COLORS = {
  good: '#3fae4a', // 최선, 좋음
  dubious: '#e6b422', // 부정확, 실수
  bad: '#d9463b', // 블런더
  unknown: '#8a8f98', // 아직 평가 전
}

export function moveColor(c: Classification | null | undefined): string {
  switch (c) {
    case 'best':
    case 'good':
      return QUALITY_COLORS.good
    case 'inaccuracy':
    case 'mistake':
      return QUALITY_COLORS.dubious
    case 'blunder':
      return QUALITY_COLORS.bad
    default:
      return QUALITY_COLORS.unknown
  }
}
