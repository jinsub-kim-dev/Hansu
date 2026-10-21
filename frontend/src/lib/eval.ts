import type { Classification } from '../api/client'
import { translate } from '../i18n'

/** centipawn → [-1, 1] 기대 승률 (백엔드 classify와 같은 식). */
export function winChance(cp: number): number {
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1
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
