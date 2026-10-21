// 통계에 넣을 대국의 기간. 전체 기간 또는 시작일~종료일(현지 날짜, 양 끝 포함).

export type Period = { mode: 'all' } | { mode: 'range'; from: string; to: string } // YYYY-MM-DD

const PRESETS: { label: string; months: number }[] = [
  { label: '1개월', months: 1 },
  { label: '3개월', months: 3 },
  { label: '1년', months: 12 },
  { label: '3년', months: 36 },
]

function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function monthsAgo(months: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d
}

function matchingPreset(p: Period) {
  if (p.mode !== 'range' || p.to !== toDateInput(new Date())) return undefined
  return PRESETS.find((x) => toDateInput(monthsAgo(x.months)) === p.from)
}

/** 접힌 필터 줄에 보여줄 짧은 이름. 전체 기간이면 null. */
export function periodLabel(p: Period): string | null {
  if (p.mode === 'all') return null
  const preset = matchingPreset(p)
  return preset ? `최근 ${preset.label}` : `${p.from.replaceAll('-', '.')} ~ ${p.to.replaceAll('-', '.')}`
}

/** 기간을 API의 since/until(ISO 시각, until은 미포함)로 바꾼다. 종료일은 그날 끝까지 포함한다. */
export function periodToQuery(p: Period): { since?: string; until?: string } {
  if (p.mode === 'all') return {}
  const since = new Date(`${p.from}T00:00:00`)
  const until = new Date(`${p.to}T00:00:00`)
  until.setDate(until.getDate() + 1)
  return { since: since.toISOString(), until: until.toISOString() }
}

interface Props {
  value: Period
  onChange: (p: Period) => void
  firstGameAt: string | null // 날짜 선택 범위의 시작
}

export function PeriodFilter({ value, onChange, firstGameAt }: Props) {
  const today = toDateInput(new Date())
  const min = firstGameAt ? toDateInput(new Date(firstGameAt)) : undefined
  const active = matchingPreset(value)

  function preset(months: number) {
    onChange({ mode: 'range', from: toDateInput(monthsAgo(months)), to: today })
  }

  return (
    <div className="period-filter">
      <div className="chips">
        <button
          className={value.mode === 'all' ? 'chip active' : 'chip'}
          aria-pressed={value.mode === 'all'}
          onClick={() => onChange({ mode: 'all' })}
        >
          전체 기간
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.months}
            className={active?.months === p.months ? 'chip active' : 'chip'}
            aria-pressed={active?.months === p.months}
            onClick={() => preset(p.months)}
          >
            최근 {p.label}
          </button>
        ))}
      </div>
      <div className="period-dates">
        <input
          type="date"
          aria-label="시작일"
          value={value.mode === 'range' ? value.from : ''}
          min={min}
          max={value.mode === 'range' ? value.to : today}
          onChange={(e) =>
            e.target.value && onChange({ mode: 'range', from: e.target.value, to: value.mode === 'range' ? value.to : today })
          }
        />
        <span className="muted">~</span>
        <input
          type="date"
          aria-label="종료일"
          value={value.mode === 'range' ? value.to : ''}
          min={value.mode === 'range' ? value.from : min}
          max={today}
          onChange={(e) =>
            e.target.value &&
            onChange({ mode: 'range', from: value.mode === 'range' ? value.from : (min ?? e.target.value), to: e.target.value })
          }
        />
      </div>
    </div>
  )
}
