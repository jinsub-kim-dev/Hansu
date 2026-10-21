import type { MoveEval, MoveStatGroup } from '../api/client'
import { CLASSIFICATION, formatEval } from '../lib/eval'

interface Props {
  group: MoveStatGroup
  colorOf: (uci: string) => string // 화살표와 같은 색
  evals: Record<string, MoveEval>
  bookMoves: Set<string> // 오프닝 이론으로 이어지는 수
  evalPending: boolean
  onHover: (uci: string | null) => void
  onPick: (uci: string) => void
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

function EvalCell({ ev, pending }: { ev: MoveEval | undefined; pending: boolean }) {
  if (!ev) return <span className="muted">{pending ? '…' : '-'}</span>
  const cls = ev.classification ? CLASSIFICATION[ev.classification] : null
  const title = cls
    ? `${cls.label}${ev.cp_loss ? ` · 최선 대비 -${(ev.cp_loss / 100).toFixed(2)}` : ''}`
    : undefined
  const whiteAhead = ev.mate !== null ? ev.mate > 0 : ev.cp >= 0
  return (
    <span className="eval-cell" title={title}>
      <span className={`eval-chip ${whiteAhead ? 'white' : 'black'}`}>{formatEval(ev.cp, ev.mate)}</span>
      {cls && <span className={`cls-badge ${cls.className}`}>{cls.symbol}</span>}
    </span>
  )
}

export function MoveStatsTable({ group, colorOf, evals, bookMoves, evalPending, onHover, onPick }: Props) {
  return (
    <table className="move-table">
      <thead>
        <tr>
          <th>수</th>
          <th>평가</th>
          <th className="num">대국</th>
          <th className="num">비율</th>
          <th>승 / 무 / 패</th>
        </tr>
      </thead>
      <tbody onMouseLeave={() => onHover(null)}>
        {group.moves.map((m) => (
          <tr
            key={m.uci}
            onMouseEnter={() => onHover(m.uci)}
            onClick={() => onPick(m.uci)}
            title="클릭하면 이 수를 둡니다"
          >
            <td className="san">
              <span className="swatch" style={{ background: colorOf(m.uci) }} />
              {m.san}
              {bookMoves.has(m.uci) && (
                <span className="book-mark" title="오프닝 이론 수" aria-label="오프닝 이론 수">
                  📖
                </span>
              )}
            </td>
            <td>
              <EvalCell ev={evals[m.uci]} pending={evalPending} />
            </td>
            <td className="num">{m.games}</td>
            <td className="num">{pct(m.games, group.total)}%</td>
            <td>
              <div className="wdl" title={`승 ${m.wins} · 무 ${m.draws} · 패 ${m.losses}`}>
                <span className="w" style={{ flexGrow: m.wins }}>{pct(m.wins, m.games) >= 15 && `${pct(m.wins, m.games)}%`}</span>
                <span className="d" style={{ flexGrow: m.draws }}>{pct(m.draws, m.games) >= 15 && `${pct(m.draws, m.games)}%`}</span>
                <span className="l" style={{ flexGrow: m.losses }}>{pct(m.losses, m.games) >= 15 && `${pct(m.losses, m.games)}%`}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
