// 오른쪽 사이드바의 "다음 수 통계" 카드: 내 진영·필터 도구 막대, 내 수/상대 수 탭, 수 목록.
import { useState } from 'react'
import { defaultPieces } from 'react-chessboard'
import type { Color, PlayerSummary, PositionMoveStats } from '../api/client'
import type { MoveEval } from '../lib/eval'
import { useI18n } from '../i18n'
import { moveColor } from '../lib/eval'
import { MoveStatsTable } from './MoveStatsTable'
import { PeriodFilter, periodLabel, type Period } from './PeriodFilter'
import { TimeClassFilter, timeClassLabel } from './TimeClassFilter'

export type Side = 'player' | 'opponent'

export interface Filters {
  period: Period
  timeClasses: string[]
}

interface Props {
  player: PlayerSummary | null
  stats: PositionMoveStats | null // 현재 포지션의 통계 (다른 포지션 것이면 null)
  side: Side
  sideColors: Record<Side, string>
  sideToMove: Color
  myColor: Color // 내 진영: 보드 아래쪽, 그리고 내가 이 색을 잡은 대국만 센다
  onMyColor: (c: Color) => void
  filters: Filters
  onFilters: (update: (f: Filters) => Filters) => void // 직전 값에 덧씌우므로 연달아 바꿔도 앞 변경이 남는다
  error: string | null
  evals: Record<string, MoveEval>
  evalPending: boolean
  bookMoves: Set<string>
  onHover: (uci: string | null) => void
  onPick: (uci: string) => void
  onArchive?: (uci: string) => void // 내가 둔 수를 복기 노트에 보관 (로그인했을 때만)
}

// 두 쪽 모두 같은 킹 모양을 쓰고 색으로만 구분한다. 글꼴마다 모양이 달라지는 ♔/♚ 문자 대신 SVG로 그린다.
function KingIcon() {
  return (
    <svg className="piece-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M11 1.5h2v2h2v2h-2v2.2h-2V5.5H9v-2h2z" />
      <path d="M4.5 10.3C4.5 8.5 6 7 7.8 7c1.3 0 2.5.8 3 2L12 11.6 13.2 9c.5-1.2 1.7-2 3-2 1.8 0 3.3 1.5 3.3 3.3 0 2.2-1.6 4.7-2.6 6.7H7.1c-1-2-2.6-4.5-2.6-6.7z" />
      <rect x="6" y="18" width="12" height="3.5" rx="1" />
    </svg>
  )
}

/** 빈 상태 가운데 그림: 보드와 같은 기물 그림으로, 비숍(뒤)과 나이트(앞)가 절반쯤 겹친다. */
function EmptyPieces() {
  return (
    <div className="empty-pieces" aria-hidden>
      <span className="piece back">{defaultPieces.wB({ fill: 'var(--empty-piece-back)' })}</span>
      <span className="piece front">{defaultPieces.wN({ fill: 'var(--empty-piece-front)' })}</span>
    </div>
  )
}

const MY_COLOR_OPTIONS: { value: Color; label: 'common.white' | 'common.black' }[] = [
  { value: 'white', label: 'common.white' },
  { value: 'black', label: 'common.black' },
]

export function StatsPanel(props: Props) {
  const { player, stats, side, sideColors, sideToMove, myColor, onMyColor, filters, onFilters } = props
  const { t, formatNumber } = useI18n()
  const [open, setOpen] = useState(false)

  const head = (
    <header className="section-head">
      <h3 className="section-title">{t('stats.title')}</h3>
      {player && (
        <span className="section-meta">
          {player.display_name ?? player.username} ·{' '}
          {t('common.games', { n: formatNumber(player.total_games), count: player.total_games })}
        </span>
      )}
    </header>
  )

  if (!player) {
    return (
      <section className="insight-section stats sec-blue">
        {head}
        <div className="section-body">
          <p className="body-text muted">{t('stats.noPlayer')}</p>
        </div>
      </section>
    )
  }

  // 적용 중인 필터: 칩으로 보여주고 ×로 하나씩 해제한다.
  const active: { key: string; label: string; tone: string; clear: () => void }[] = []
  const pl = periodLabel(filters.period)
  if (pl) active.push({ key: 'period', label: pl, tone: 'teal', clear: () => onFilters((f) => ({ ...f, period: { mode: 'all' } })) })
  for (const tc of filters.timeClasses)
    active.push({
      key: `tc-${tc}`,
      label: timeClassLabel(tc),
      tone: `tc-${tc}`,
      clear: () => onFilters((f) => ({ ...f, timeClasses: f.timeClasses.filter((x) => x !== tc) })),
    })

  const colorName = (c: Color) => t(c === 'white' ? 'common.white' : 'common.black')
  const turn = colorName(sideToMove)
  const group = stats ? stats[side] : null

  return (
    <section className="insight-section stats sec-blue">
      {head}
      <div className="section-body">
        {/* 도구 막대: 내 진영 + 필터 */}
        <div className="field">
          <span className="field-label">{t('stats.mySide')}</span>
          <div className="toolbar">
            <div className="seg seg-sm side-pick" role="radiogroup" aria-label={t('stats.mySide')}>
              {MY_COLOR_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  role="radio"
                  aria-checked={myColor === o.value}
                  className={`pick-${o.value}${myColor === o.value ? ' active' : ''}`}
                  onClick={() => onMyColor(o.value)}
                >
                  <KingIcon />
                  {t(o.label)}
                </button>
              ))}
            </div>
            <button
              className={open ? 'ctl-btn open' : 'ctl-btn'}
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {t('stats.filter')}
              {active.length > 0 && <span className="ctl-count">{active.length}</span>}
              <span className="caret">{open ? '▴' : '▾'}</span>
            </button>
          </div>
        </div>

        {active.length > 0 && (
          <div className="field">
            <span className="field-label">{t('stats.applied')}</span>
            <div className="tag-list">
              {active.map((a) => (
                <span key={a.key} className={`filter-tag tone-${a.tone}`}>
                  {a.label}
                  <button onClick={a.clear} aria-label={t('stats.removeFilter', { label: a.label })}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {open && (
          <div className="filter-drawer">
            <div className="field top">
              <span className="field-label">{t('stats.period')}</span>
              <PeriodFilter
                value={filters.period}
                onChange={(period) => onFilters((f) => ({ ...f, period }))}
                firstGameAt={player.first_game_at}
              />
            </div>
            <div className="field top">
              <span className="field-label">{t('stats.timeClass')}</span>
              <TimeClassFilter
                counts={player.by_time_class}
                selected={filters.timeClasses}
                onChange={(timeClasses) => onFilters((f) => ({ ...f, timeClasses }))}
              />
            </div>
          </div>
        )}

        {/* 내 진영 대국만 세므로 차례인 쪽 탭만 데이터가 있다. 다른 탭은 비활성화한다. */}
        <div className="side-tabs" role="tablist">
          {(['player', 'opponent'] as const).map((s) => {
            const on = side === s
            const opp = colorName(myColor === 'white' ? 'black' : 'white')
            const why = s === 'opponent' ? t('stats.notOppTurn', { turn, opp }) : t('stats.notMyTurn', { turn })
            return (
              <button
                key={s}
                role="tab"
                aria-selected={on}
                aria-disabled={!on}
                disabled={!on}
                className={on ? 'active' : ''}
                style={{ '--side': sideColors[s] } as React.CSSProperties}
                title={on ? undefined : why}
              >
                <span className="dot" />
                {t(s === 'player' ? 'stats.myMoves' : 'stats.oppMoves')}
                <span className="count">{on && stats ? formatNumber(stats[s].total) : '—'}</span>
              </button>
            )
          })}
        </div>

        {/* 목록 제목: 차례 · 대상 대국 · 승률 기준 */}
        <div className="list-head">
          <span className={`turn-chip ${sideToMove}`}>
            <span className="turn-dot" aria-hidden />
            {t('stats.turn', { turn })}
          </span>
          <span className="list-title">{t('stats.listTitle', { color: colorName(myColor) })}</span>
          <span className="list-note">{t('stats.listNote')}</span>
        </div>

        {props.error && <p className="error">{props.error}</p>}
        {group && group.total === 0 && (
          <div className="empty-state">
            <EmptyPieces />
            <p className="empty-title">
              {t(active.length > 0 ? 'stats.emptyFilteredTitle' : 'stats.emptyTitle')}
            </p>
            <p className="empty-desc">
              {t(active.length > 0 ? 'stats.emptyFilteredDesc' : 'stats.emptyDesc')}
            </p>
            {active.length > 0 && (
              <button
                className="ctl-btn empty-action"
                onClick={() => onFilters(() => ({ period: { mode: 'all' }, timeClasses: [] }))}
              >
                {t('stats.resetFilters')}
              </button>
            )}
          </div>
        )}
        {group && group.total > 0 && (
          <div className="table-scroll">
            <MoveStatsTable
              group={group}
              colorOf={(uci) => moveColor(props.evals[uci]?.classification)}
              evals={props.evals}
              bookMoves={props.bookMoves}
              evalPending={props.evalPending}
              onHover={props.onHover}
              onPick={props.onPick}
              onArchive={props.side === 'player' ? props.onArchive : undefined}
            />
          </div>
        )}
      </div>
    </section>
  )
}
