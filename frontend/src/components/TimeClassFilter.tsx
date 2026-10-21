// 시간 규칙 필터. 여러 개를 함께 고를 수 있고, 아무것도 고르지 않으면 전체.

const TIME_CLASSES: { value: string; label: string }[] = [
  { value: 'bullet', label: '불렛' },
  { value: 'blitz', label: '블리츠' },
  { value: 'rapid', label: '래피드' },
  { value: 'classical', label: '클래시컬' },
  { value: 'daily', label: '일일 체스' },
]

export function timeClassLabel(value: string): string {
  return TIME_CLASSES.find((t) => t.value === value)?.label ?? value
}

interface Props {
  counts: Record<string, number> // 시간 규칙별 대국 수
  selected: string[]
  onChange: (selected: string[]) => void
}

export function TimeClassFilter({ counts, selected, onChange }: Props) {
  // 대국이 없는 클래시컬(체스닷컴에는 없음)은 숨기고, 모르는 시간 규칙은 뒤에 붙인다.
  const known = new Set(TIME_CLASSES.map((t) => t.value))
  const options = [
    ...TIME_CLASSES.filter((t) => t.value !== 'classical' || counts.classical),
    ...Object.keys(counts)
      .filter((tc) => !known.has(tc))
      .map((tc) => ({ value: tc, label: tc })),
  ]

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="chips" role="group" aria-label="시간 규칙">
      <button
        className={selected.length === 0 ? 'chip active' : 'chip'}
        aria-pressed={selected.length === 0}
        onClick={() => onChange([])}
      >
        전체
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
            <span className="count">{n.toLocaleString()}</span>
          </button>
        )
      })}
    </div>
  )
}
