// 복기 노트 목록: 보관한 포지션을 카드로 모아 보고, 카드를 누르면 탐색 화면에서 그 포지션을 연다.
import { useEffect, useMemo, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { ApiError, listReviews, type Color, type Review } from '../api/client'
import { ConnectAccountState, EmptyState, LoadingState } from '../components/EmptyState'
import { MoveArrows } from '../components/MoveArrows'
import { sanOf } from '../components/ReviewPanel'
import { useI18n } from '../i18n'
import { CLASSIFICATION, classificationLabel, moveColor, QUALITY_COLORS } from '../lib/eval'

interface Props {
  active: boolean
  onOpen: (review: Review) => void
  onGo: (view: 'explore' | 'games') => void // 빈 화면에서 다른 탭으로 안내
}

type Status = 'all' | 'todo' | 'done'

function MiniBoard({ review }: { review: Review }) {
  return (
    <div className="mini-board">
      <Chessboard
        options={{
          id: `review-${review.id}`,
          position: review.fen,
          boardOrientation: review.color,
          allowDragging: false,
          showNotation: false,
          showAnimations: false,
        }}
      />
      <MoveArrows
        moves={[]}
        total={0}
        orientation={review.color}
        colorOf={() => QUALITY_COLORS.unknown}
        highlighted={null}
        bold
        bestMove={review.best_move && review.best_move !== review.my_move ? review.best_move : null}
        pinned={
          review.my_move
            ? {
                uci: review.my_move,
                color: review.classification ? moveColor(review.classification) : QUALITY_COLORS.unknown,
              }
            : null
        }
      />
    </div>
  )
}

export function ReviewsPage({ active, onOpen, onGo }: Props) {
  const { t, formatDate } = useI18n()
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [loginRequired, setLoginRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('all')
  const [color, setColor] = useState<Color | 'all'>('all')
  const [tag, setTag] = useState('')

  // 화면을 열 때마다 새로 읽는다(탐색 화면에서 보관·수정했을 수 있다).
  useEffect(() => {
    if (!active) return
    const ctrl = new AbortController()
    listReviews(ctrl.signal)
      .then((r) => {
        setReviews(r)
        setLoginRequired(false)
        setError(null)
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return
        if (e instanceof ApiError && e.status === 401) setLoginRequired(true)
        else setError((e as Error).message)
      })
    return () => ctrl.abort()
  }, [active])

  const tags = useMemo(() => [...new Set((reviews ?? []).flatMap((r) => r.tags))].sort(), [reviews])
  const shown = (reviews ?? []).filter(
    (r) =>
      (status === 'all' || (status === 'done') === !!r.reviewed_at) &&
      (color === 'all' || r.color === color) &&
      (!tag || r.tags.includes(tag)),
  )
  const counts = {
    all: reviews?.length ?? 0,
    todo: (reviews ?? []).filter((r) => !r.reviewed_at).length,
    done: (reviews ?? []).filter((r) => r.reviewed_at).length,
  }

  let body: React.ReactNode
  if (loginRequired) {
    body = <ConnectAccountState description={t('empty.reviewsConnect')} />
  } else if (error) {
    body = <p className="error">{error}</p>
  } else if (!reviews) {
    body = <LoadingState />
  } else if (reviews.length === 0) {
    body = (
      <EmptyState
        icon="reviews"
        tone="rose"
        title={t('empty.noReviewsTitle')}
        actions={
          <>
            <button onClick={() => onGo('games')}>{t('empty.goGames')}</button>
            <button className="secondary" onClick={() => onGo('explore')}>
              {t('empty.goExplore')}
            </button>
          </>
        }
      >
        {t('reviews.empty')}
      </EmptyState>
    )
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        icon="search"
        tone="muted"
        title={t('reviews.noMatch')}
        actions={
          <button
            className="secondary"
            onClick={() => {
              setStatus('all')
              setColor('all')
              setTag('')
            }}
          >
            {t('empty.resetFilters')}
          </button>
        }
      />
    )
  } else {
    body = (
      <ul className="review-grid">
        {shown.map((r) => {
          const mySan = sanOf(r.fen, r.my_move)
          const bestSan = r.best_move !== r.my_move ? sanOf(r.fen, r.best_move) : null
          const cls = r.classification ? CLASSIFICATION[r.classification] : null
          const lastNote = r.notes[r.notes.length - 1]
          return (
            <li key={r.id}>
              <button className="review-card" onClick={() => onOpen(r)} title={t('reviews.open')}>
                <MiniBoard review={r} />
                <div className="card-body">
                  <div className="card-moves">
                    {cls && (
                      <span className={`cls-badge ${cls.className}`} title={classificationLabel(r.classification!)}>
                        {cls.symbol}
                      </span>
                    )}
                    {mySan ? (
                      <span>
                        {t('review.myMove')} <b>{mySan}</b>
                      </span>
                    ) : (
                      <span className="muted">{t('reviews.noMyMove')}</span>
                    )}
                    {bestSan && (
                      <span className="muted">
                        · {t('review.best')} <b className="best">{bestSan}</b>
                      </span>
                    )}
                  </div>
                  {r.tags.length > 0 && (
                    <div className="card-tags">
                      {r.tags.map((x) => (
                        <span key={x} className="tag-chip static">
                          {x}
                        </span>
                      ))}
                    </div>
                  )}
                  {lastNote && <p className="card-note">{lastNote.body}</p>}
                  <div className="card-foot">
                    <span>{t(r.color === 'white' ? 'common.white' : 'common.black')}</span>
                    <span>{t('reviews.savedOn', { date: formatDate(r.created_at) })}</span>
                    {r.reviewed_at ? (
                      <span className="reviewed">✓ {t('reviews.reviewedOn', { date: formatDate(r.reviewed_at) })}</span>
                    ) : (
                      <span className="todo">{t('reviews.todo')}</span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="reviews-page">
      <div className="reviews-head">
        <h2>
          {t('review.title')}
          {reviews && <span className="muted"> {reviews.length}</span>}
        </h2>
        {reviews && reviews.length > 0 && (
          <div className="reviews-filters">
            <div className="seg">
              {(['all', 'todo', 'done'] as Status[]).map((s) => (
                <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                  {t(`reviews.status.${s}`)} <span className="count">{counts[s]}</span>
                </button>
              ))}
            </div>
            <div className="seg">
              {(['all', 'white', 'black'] as const).map((c) => (
                <button key={c} className={color === c ? 'active' : ''} onClick={() => setColor(c)}>
                  {t(c === 'all' ? 'reviews.color.all' : c === 'white' ? 'common.white' : 'common.black')}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t('review.tags')}>
                <option value="">{t('reviews.allTags')}</option>
                {tags.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
      {body}
    </div>
  )
}
