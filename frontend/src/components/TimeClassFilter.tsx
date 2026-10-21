// 시간 규칙 필터. 여러 개를 함께 고를 수 있고, 아무것도 고르지 않으면 전체.
import { translate, useI18n } from '../i18n'

const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'classical', 'daily'] as const

/** 시간 규칙 이름(현재 언어). 모르는 값은 그대로. */
export function timeClassLabel(value: string): string {
  return (TIME_CLASSES as readonly string[]).includes(value) ? translate(`tc.${value as (typeof TIME_CLASSES)[number]}`) : value
}

interface Props {
  counts: Record<string, number> // 시간 규칙별 대국 수
  selected: string[]
  onChange: (selected: string[]) => void
}

export function TimeClassFilter({ counts, selected, onChange }: Props) {
  // 대국이 없는 클래시컬(체스닷컴에는 없음)은 숨기고, 모르는 시간 규칙은 뒤에 붙인다.
  const { t, formatNumber } = useI18n()
  const known = new Set<string>(TIME_CLASSES)
  const options = [
    ...TIME_CLASSES.filter((v) => v !== 'classical' || counts.classical).map((v) => ({ value: v as string, label: timeClassLabel(v) })),
    ...Object.keys(counts)
      .filter((tc) => !known.has(tc))
      .map((tc) => ({ value: tc, label: tc })),
  ]

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="chips" role="group" aria-label={t('stats.timeClass')}>
      <button
        className={selected.length === 0 ? 'chip active' : 'chip'}
        aria-pressed={selected.length === 0}
        onClick={() => onChange([])}
      >
        {t('tc.all')}
      </button>
      {options.map(({ value, label }) => {
        const n = counts[value] ?? 0
        const on = selected.includes(value)
        return (
          <button
            key={value}
            className={on ? 'chip active' : 'chip'}
            aria-pressed={on}
            disabled={n === 0 && !on}
            onClick={() => toggle(value)}
          >
            <span className={`tc-dot tc-${value}`} />
            {label}
            <span className="count">{formatNumber(n)}</span>
          </button>
        )
      })}
    </div>
  )
}
