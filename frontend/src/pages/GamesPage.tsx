// 대국 목록: 연결한 계정의 최근 대국. 대국을 누르면 탐색 화면에서 그 대국을 연다.
import { useEffect, useState } from 'react'
import {
  ApiError,
  listGames,
  listPlayers,
  platformLabel,
  type Color,
  type GameSummary,
  type Outcome,
  type SavedPlayer,
} from '../api/client'
import { ConnectAccountState, EmptyState, LoadingState } from '../components/EmptyState'
import { PlatformBadge } from '../components/PlatformBadge'
import { timeClassLabel } from '../components/TimeClassFilter'
import { useI18n } from '../i18n'

interface Props {
  active: boolean
  onOpen: (game: GameSummary) => void
  onGo: (view: 'explore') => void // 빈 화면에서 다른 탭으로 안내
}

const PAGE = 30
const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'classical', 'daily']

/** "180+2"(초+증가) → "3+2". 형식을 모르면 그대로. */
export function formatTimeControl(tc: string | null): string {
  const m = tc?.match(/^(\d+)(?:\+(\d+))?$/)
  if (!m) return ''
  const base = Number(m[1]) / 60
  const min = base >= 1 ? String(Math.round(base * 10) / 10) : `${m[1]}s`
  return m[2] !== undefined ? `${min}+${m[2]}` : min
}

export function GamesPage({ active, onOpen, onGo }: Props) {
  const { t, locale, formatNumber } = useI18n()
  const [accounts, setAccounts] = useState<SavedPlayer[] | null>(null)
  const [account, setAccount] = useState<SavedPlayer | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [timeClasses, setTimeClasses] = useState<string[]>([])
  const [color, setColor] = useState<Color | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [games, setGames] = useState<GameSummary[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 화면을 열 때마다 연결 계정을 다시 읽는다(그사이 계정을 연결·해제했을 수 있다).
  useEffect(() => {
    if (!active) return
    listPlayers()
      .then((list) => {
        setAccounts(list)
        setAccount((cur) => list.find((p) => p.platform === cur?.platform && p.username === cur?.username) ?? list[0] ?? null)
        setLoginRequired(false)
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setLoginRequired(true)
        else setError((e as Error).message)
      })
  }, [active])

  // 계정·필터가 바뀌면 첫 페이지부터 다시 받는다.
  useEffect(() => {
    if (!active || !account) return
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    listGames(account.platform, account.username, { timeClasses, color, outcome, limit: PAGE }, ctrl.signal)
      .then((r) => {
        setGames(r.games)
        setTotal(r.total)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError((e as Error).message)
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [active, account, timeClasses, color, outcome])

  async function more() {
    if (!account) return
    setLoading(true)
    try {
      const r = await listGames(account.platform, account.username, {
        timeClasses,
        color,
        outcome,
        offset: games.length,
        limit: PAGE,
      })
      setGames((g) => [...g, ...r.games])
      setTotal(r.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // 끝난 달별로 묶는다(목록은 이미 최근 순).
  const groups: { key: string; label: string; items: GameSummary[] }[] = []
  for (const g of games) {
    const d = g.end_time ? new Date(g.end_time) : null
    const key = d ? `${d.getFullYear()}-${d.getMonth()}` : '-'
    if (groups[groups.length - 1]?.key !== key) {
      groups.push({ key, label: d ? d.toLocaleDateString(locale, { year: 'numeric', month: 'long' }) : '-', items: [] })
    }
    groups[groups.length - 1].items.push(g)
  }
  const formatDay = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '-'

  function toggleTc(tc: string) {
    setTimeClasses((cur) => (cur.includes(tc) ? cur.filter((x) => x !== tc) : [...cur, tc]))
  }

  const filtered = timeClasses.length > 0 || color !== null || outcome !== null
  const noGamesYet = !!account && account.total_games === 0
  let body: React.ReactNode
  if (error && !accounts) {
    body = <p className="error">{error}</p>
  } else if (loginRequired || (accounts && accounts.length === 0)) {
    // 로그인하지 않았으면 연결 계정 목록이 비어 온다.
    body = <ConnectAccountState description={t('empty.gamesConnect')} />
  } else if (!accounts || (total === null && loading)) {
    body = <LoadingState />
  } else if (noGamesYet) {
    body = (
      <EmptyState
        icon="import"
        tone="teal"
        title={t('empty.noGamesTitle')}
        actions={<button onClick={() => onGo('explore')}>{t('empty.goImport')}</button>}
      >
        {t('empty.noGamesDesc')}
      </EmptyState>
    )
  } else if (total === 0 && !loading) {
    body = (
      <EmptyState
        icon="search"
        tone="muted"
        title={t('games.empty')}
        actions={
          filtered && (
            <button
              className="secondary"
              onClick={() => {
                setTimeClasses([])
                setColor(null)
                setOutcome(null)
              }}
            >
              {t('empty.resetFilters')}
            </button>
          )
        }
      />
    )
  } else {
    body = (
      <>
        {groups.map(({ key, label, items }) => (
          <section key={key} className="game-group">
            <h3 className="game-group-title">{label}</h3>
            <ul className="game-list">
              {items.map((g) => (
                <li key={g.id}>
                  <button className="game-row" onClick={() => onOpen(g)} title={t('games.open')}>
                    <span className={`outcome ${g.outcome}`}>{t(`games.outcome.${g.outcome}`)}</span>
                    <span className="game-main">
                      <span className="game-title">
                        <span
                          className={`piece-dot ${g.color}`}
                          title={t(g.color === 'white' ? 'games.playedWhite' : 'games.playedBlack')}
                        />
                        <span className="vs">vs</span>
                        <b className="opp">{g.opponent}</b>
                        {g.opponent_rating && <span className="rating">{g.opponent_rating}</span>}
                      </span>
                      <span className="game-sub">
                        {g.opening ? (
                          <>
                            <span className="eco">{g.opening.eco}</span> {g.opening.name}
                          </>
                        ) : (
                          t('games.noOpening')
                        )}
                      </span>
                    </span>
                    <span className="game-side">
                      <span className="game-day">{formatDay(g.end_time)}</span>
                      <span className="game-sub">
                        {[
                          g.time_class && timeClassLabel(g.time_class),
                          formatTimeControl(g.time_control),
                          t('games.moves', { n: Math.ceil(g.plies / 2) }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>
                  {g.url && (
                    <a
                      className="game-link"
                      href={g.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={t('games.openOnPlatform', { platform: platformLabel(g.platform) })}
                      aria-label={t('games.openOnPlatform', { platform: platformLabel(g.platform) })}
                    >
                      ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {error && <p className="error">{error}</p>}
        {total !== null && games.length < total && (
          <button className="secondary more-games" onClick={more} disabled={loading}>
            {loading ? t('reviews.loading') : t('games.more', { n: formatNumber(total - games.length) })}
          </button>
        )}
      </>
    )
  }

  return (
    <div className="reviews-page games-page">
      <div className="reviews-head">
        <h2>
          {t('nav.games')}
          {total !== null && <span className="muted"> {formatNumber(total)}</span>}
        </h2>
        {/* 어느 플랫폼의 어느 계정 대국인지 항상 보여 주고, 계정이 여럿이면 여기서 고른다. */}
        {accounts && accounts.length > 0 && (
          <div className="account-switch" role="group" aria-label={t('games.account')}>
            {accounts.map((a) => {
              const active = account?.platform === a.platform && account.username === a.username
              const Tag = accounts.length > 1 ? 'button' : 'span'
              return (
                <Tag
                  key={`${a.platform}/${a.username}`}
                  className={`account-chip ${active ? 'active' : ''}`}
                  {...(accounts.length > 1 ? { onClick: () => setAccount(a), 'aria-pressed': active } : {})}
                >
                  <PlatformBadge platform={a.platform} />
                  <span className="platform-name">{platformLabel(a.platform)}</span>
                  <b>{a.display_name ?? a.username}</b>
                  <span className="games-count">{t('common.games', { n: formatNumber(a.total_games), count: a.total_games })}</span>
                </Tag>
              )
            })}
          </div>
        )}
      </div>
      {accounts && accounts.length > 0 && !noGamesYet && (
        <div className="games-toolbar">
          <div className="seg">
            {([null, 'win', 'draw', 'loss'] as (Outcome | null)[]).map((o) => (
              <button key={o ?? 'all'} className={outcome === o ? 'active' : ''} onClick={() => setOutcome(o)}>
                {o ? t(`games.outcome.${o}`) : t('reviews.status.all')}
              </button>
            ))}
          </div>
          <div className="seg">
            {([null, 'white', 'black'] as (Color | null)[]).map((c) => (
              <button key={c ?? 'all'} className={color === c ? 'active' : ''} onClick={() => setColor(c)}>
                {t(c === null ? 'reviews.color.all' : c === 'white' ? 'common.white' : 'common.black')}
              </button>
            ))}
          </div>
          <div className="chips tc-chips">
            {TIME_CLASSES.map((tc) => (
              <button key={tc} className={`chip ${timeClasses.includes(tc) ? 'active' : ''}`} onClick={() => toggleTc(tc)}>
                {timeClassLabel(tc)}
              </button>
            ))}
          </div>
        </div>
      )}
      {body}
    </div>
  )
}
