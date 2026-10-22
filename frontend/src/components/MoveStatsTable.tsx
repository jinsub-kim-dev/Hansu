import type { MoveStatGroup } from '../api/client'
import type { MoveEval } from '../lib/eval'
import { useI18n } from '../i18n'
import { CLASSIFICATION, classificationLabel, formatEval } from '../lib/eval'

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
  const { t } = useI18n()
  if (!ev) return <span className="muted">{pending ? '…' : '-'}</span>
  const cls = ev.classification ? CLASSIFICATION[ev.classification] : null
  const title =
    cls && ev.classification
      ? classificationLabel(ev.classification) +
        (ev.cp_loss ? t('table.lossVsBest', { loss: (ev.cp_loss / 100).toFixed(2) }) : '')
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
  const { t, formatNumber } = useI18n()
  return (
    <table className="move-table">
      <thead>
        <tr>
          <th>{t('table.move')}</th>
          <th>{t('table.eval')}</th>
          <th className="num">{t('table.games')}</th>
          <th className="num">{t('table.share')}</th>
          <th>{t('table.wdl')}</th>
        </tr>
      </thead>
      <tbody onMouseLeave={() => onHover(null)}>
        {group.moves.map((m) => (
          <tr
            key={m.uci}
            onMouseEnter={() => onHover(m.uci)}
            onClick={() => onPick(m.uci)}
            title={t('table.clickToPlay')}
          >
            <td className="san">
              <span className="swatch" style={{ background: colorOf(m.uci) }} />
              {m.san}
              {bookMoves.has(m.uci) && (
                <span className="book-mark" title={t('table.bookMove')} aria-label={t('table.bookMove')}>
                  📖
                </span>
              )}
            </td>
            <td>
              <EvalCell ev={evals[m.uci]} pending={evalPending} />
            </td>
            <td className="num">{formatNumber(m.games)}</td>
            <td className="num">{pct(m.games, group.total)}%</td>
            <td>
              <div className="wdl" title={t('table.wdlTitle', { w: m.wins, d: m.draws, l: m.losses })}>
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
