// 왼쪽 사이드바의 "복기 노트": 지금 보드의 포지션을 보관하고, 내 수와 엔진 최선 수를 비교하며 날짜별 메모를 쌓는다.
import { Chess } from 'chess.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addReviewNote,
  createReview,
  deleteReview,
  deleteReviewNote,
  updateReview,
  type Color,
  type GameDetail,
  type Review,
} from '../api/client'
import { useI18n, type MessageKey } from '../i18n'
import { CLASSIFICATION, classificationLabel, formatEval, type MoveEval, type PositionEval } from '../lib/eval'
import { fenAt, type Line } from '../lib/line'

interface Props {
  fen: string
  line: Line
  ply: number
  myColor: Color
  evaluation: PositionEval | null
  review: Review | null
  loginRequired: boolean
  loading: boolean
  onChange: (review: Review | null) => void
  draftMove: string | null // 통계 표에서 "보관"을 누른 수
  onDraftUsed: () => void
  onPlay: (uci: string) => void
  onGoTo: (ply: number) => void // 보관한 포지션으로 보드를 옮긴다
  game: GameDetail | null // 대국을 보는 중이면 대국 주소·날짜를 채운다
}

export const PRESET_TAGS: MessageKey[] = [
  'review.tag.blunder',
  'review.tag.mistake',
  'review.tag.missed',
  'review.tag.opening',
  'review.tag.middlegame',
  'review.tag.endgame',
  'review.tag.time',
]

/** 보관할 포지션: 내 수를 두기 직전 포지션.
 *  내 차례면 지금 포지션(라인의 다음 수가 내 수), 상대 차례면 방금 둔 수를 내 수로 보고 그 직전 포지션. */
function targetFor(line: Line, ply: number, color: Color): { ply: number; fen: string; move: string | null; shifted: boolean } {
  const fen = fenAt(line, ply)
  const turn: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black'
  if (turn === color) return { ply, fen, move: line.moves[ply]?.uci ?? null, shifted: false }
  if (ply > 0) return { ply: ply - 1, fen: fenAt(line, ply - 1), move: line.moves[ply - 1].uci, shifted: true }
  return { ply, fen, move: null, shifted: false }
}

interface Draft {
  color: Color
  myMove: string
  myIdea: string
  tags: string[]
  sourceUrl: string
  gameDate: string
  note: string
}

/** 이 포지션에서 둘 수 있는 수 (UCI, SAN) */
function legalMoves(fen: string): { uci: string; san: string }[] {
  try {
    return new Chess(fen)
      .moves({ verbose: true })
      .map((m) => ({ uci: m.from + m.to + (m.promotion ?? ''), san: m.san }))
  } catch {
    return []
  }
}

/** ISO 시각 → 현지 날짜 YYYY-MM-DD (date 입력 칸 형식) */
function localDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function sanOf(fen: string, uci: string | null): string | null {
  if (!uci) return null
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san
  } catch {
    return null
  }
}

function EvalBadge({ ev, fallback }: { ev: MoveEval | undefined; fallback?: Review['classification'] }) {
  const cls = ev?.classification ?? fallback ?? null
  return (
    <>
      {ev && (
        <span className={`eval-chip ${(ev.mate !== null ? ev.mate > 0 : ev.cp >= 0) ? 'white' : 'black'}`}>
          {formatEval(ev.cp, ev.mate)}
        </span>
      )}
      {cls && (
        <span className={`cls-badge ${CLASSIFICATION[cls].className}`} title={classificationLabel(cls)}>
          {CLASSIFICATION[cls].symbol}
        </span>
      )}
    </>
  )
}

export function ReviewPanel(props: Props) {
  const { fen, line, ply, myColor, evaluation, review, loginRequired, loading, onChange } = props
  const { t, formatDate } = useI18n()
  const [draft, setDraft] = useState<Draft | null>(null) // 보관/편집 양식
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customTag, setCustomTag] = useState('')
  const ref = useRef<HTMLElement>(null)
  // 새로 보관할 때는 내 수를 두기 직전 포지션을, 이미 보관한 노트를 고칠 때는 지금 포지션을 쓴다.
  const target = review ? { ply, fen, move: null, shifted: false } : targetFor(line, ply, draft?.color ?? myColor)
  const moves = useMemo(() => legalMoves(target.fen), [target.fen])

  // 포지션이 바뀌면 열려 있던 양식을 닫는다.
  useEffect(() => {
    setDraft(null)
    setError(null)
    setNote('')
  }, [fen])

  // 통계 표에서 보관을 누르면 그 수를 내 수로 넣어 양식을 연다.
  const { draftMove, onDraftUsed } = props
  useEffect(() => {
    if (!draftMove || loginRequired) return
    openForm(draftMove)
    onDraftUsed()
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftMove])

  // 보관할 때 엔진 평가가 아직 없었으면, 평가가 끝난 뒤 목록용 판정·최선 수를 채운다.
  const evals = useMemo(
    () => Object.fromEntries((evaluation?.moves ?? []).map((m) => [m.uci, m])),
    [evaluation],
  )
  const best = evaluation?.position?.best_uci ?? null
  useEffect(() => {
    if (!review || evaluation?.status !== 'done' || !best) return
    const cls = review.my_move ? (evals[review.my_move]?.classification ?? null) : null
    if (review.best_move === best && (!review.my_move || review.classification === cls || !cls)) return
    updateReview(review.id, { best_move: best, ...(cls ? { classification: cls } : {}) })
      .then(onChange)
      .catch(() => {})
  }, [review, evaluation?.status, best, evals, onChange])

  function openForm(move?: string) {
    setError(null)
    setDraft(
      review
        ? {
            color: review.color,
            myMove: move ?? review.my_move ?? '',
            myIdea: review.my_idea ?? '',
            tags: review.tags,
            sourceUrl: review.source_url ?? '',
            gameDate: review.game_date ?? '',
            note: '',
          }
        : {
            color: myColor,
            // PGN을 따라왔으면 라인에서 내가 둔 수를 채운다(통계 표에서 고른 수가 있으면 그 수).
            myMove: move ?? targetFor(line, ply, myColor).move ?? '',
            myIdea: '',
            tags: [],
            sourceUrl: props.game?.url ?? '',
            gameDate: localDate(props.game?.end_time ?? null),
            note: '',
          },
    )
  }

  async function run(action: () => Promise<Review | null>) {
    setBusy(true)
    setError(null)
    try {
      onChange(await action())
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (!draft) return
    const fields = {
      color: draft.color,
      my_move: draft.myMove || null,
      my_idea: draft.myIdea || null,
      tags: draft.tags,
      source_url: draft.sourceUrl.trim() || null,
      game_date: draft.gameDate || null,
      // 평가는 지금 보드의 포지션 것이라, 직전 포지션을 보관할 때는 그 포지션으로 옮긴 뒤 채운다.
      best_move: target.shifted ? null : best,
      classification: !target.shifted && draft.myMove ? (evals[draft.myMove]?.classification ?? null) : null,
    }
    const ok = await run(() =>
      review
        ? updateReview(review.id, fields)
        : createReview({
            ...fields,
            start_fen: line.startFen,
            moves: line.moves.slice(0, target.ply).map((m) => m.uci),
            note: draft.note.trim() || null,
          }),
    )
    if (ok) {
      setDraft(null)
      if (target.shifted) props.onGoTo(target.ply)
    }
  }

  // 입력이 연달아 바뀌어도 앞 변경이 남도록 직전 값에 덧씌운다.
  function patch(p: Partial<Draft>) {
    setDraft((d) => d && { ...d, ...p })
  }

  function toggleTag(tag: string) {
    setDraft((d) => d && { ...d, tags: d.tags.includes(tag) ? d.tags.filter((x) => x !== tag) : [...d.tags, tag] })
  }

  function addCustomTag() {
    const tag = customTag.trim()
    if (tag && draft && !draft.tags.includes(tag)) patch({ tags: [...draft.tags, tag] })
    setCustomTag('')
  }

  let body: React.ReactNode
  if (loginRequired) {
    body = <p className="body-text muted small">{t('review.loginHint')}</p>
  } else if (draft) {
    const presets = PRESET_TAGS.map((k) => t(k))
    const extra = draft.tags.filter((x) => !presets.includes(x))
    body = (
      <form
        className="review-form"
        onSubmit={(e) => {
          e.preventDefault()
          saveDraft()
        }}
      >
        {target.shifted && (
          <p className="body-text muted small shifted-hint">
            {t('review.shiftedHint', { san: sanOf(target.fen, target.move) ?? '' })}
          </p>
        )}
        <div className="field">
          <span className="field-label">{t('review.color')}</span>
          <div className="seg">
            {(['white', 'black'] as Color[]).map((c) => (
              <button
                key={c}
                type="button"
                className={draft.color === c ? 'active' : ''}
                onClick={() => patch({ color: c, myMove: review ? draft.myMove : (targetFor(line, ply, c).move ?? '') })}
              >
                {t(c === 'white' ? 'common.white' : 'common.black')}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">{t('review.myMove')}</span>
          <select value={draft.myMove} onChange={(e) => patch({ myMove: e.target.value })}>
            <option value="">{t('review.none')}</option>
            {moves.map((m) => (
              <option key={m.uci} value={m.uci}>
                {m.san}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('review.myIdea')}</span>
          <select value={draft.myIdea} onChange={(e) => patch({ myIdea: e.target.value })}>
            <option value="">{t('review.none')}</option>
            {moves.map((m) => (
              <option key={m.uci} value={m.uci}>
                {m.san}
              </option>
            ))}
          </select>
        </label>
        <div className="field top">
          <span className="field-label">{t('review.tags')}</span>
          <div className="tag-picker">
            {[...presets, ...extra].map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-chip ${draft.tags.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
            <input
              className="tag-input"
              value={customTag}
              maxLength={20}
              placeholder={t('review.addTag')}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCustomTag()
                }
              }}
              onBlur={addCustomTag}
            />
          </div>
        </div>
        <label className="field">
          <span className="field-label">{t('review.source')}</span>
          <input
            type="url"
            value={draft.sourceUrl}
            placeholder="https://"
            onChange={(e) => patch({ sourceUrl: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('review.gameDate')}</span>
          <input type="date" value={draft.gameDate} onChange={(e) => patch({ gameDate: e.target.value })} />
        </label>
        {!review && (
          <textarea
            className="note-input"
            rows={3}
            value={draft.note}
            maxLength={4000}
            placeholder={t('review.notePlaceholder')}
            onChange={(e) => patch({ note: e.target.value })}
          />
        )}
        <div className="row">
          <button type="submit" disabled={busy}>
            {review ? t('review.saveEdit') : t('review.save')}
          </button>
          <button type="button" className="secondary" onClick={() => setDraft(null)}>
            {t('review.cancel')}
          </button>
        </div>
      </form>
    )
  } else if (!review) {
    body = (
      <>
        <button className="secondary archive-btn" onClick={() => openForm()} disabled={loading}>
          ☆ {t('review.archive')}
        </button>
        <p className="body-text muted small">{t('review.emptyHint')}</p>
      </>
    )
  } else {
    const mySan = sanOf(fen, review.my_move)
    const bestSan = sanOf(fen, best ?? review.best_move)
    const ideaSan = sanOf(fen, review.my_idea)
    const bestEv = best ? evals[best] : undefined
    body = (
      <>
        <dl className="compare">
          <dt>{t('review.myMove')}</dt>
          <dd>
            {mySan ? (
              <>
                <button className="move-link" onClick={() => props.onPlay(review.my_move!)} title={t('review.playIt')}>
                  {mySan}
                </button>
                <EvalBadge ev={evals[review.my_move!]} fallback={review.classification} />
              </>
            ) : (
              <span className="muted">-</span>
            )}
          </dd>
          <dt>{t('review.best')}</dt>
          <dd>
            {bestSan ? (
              <>
                <button className="move-link best" onClick={() => props.onPlay(best ?? review.best_move!)} title={t('review.playIt')}>
                  {bestSan}
                </button>
                <EvalBadge ev={bestEv} />
              </>
            ) : (
              <span className="muted">{evaluation?.status === 'pending' ? '…' : '-'}</span>
            )}
          </dd>
          {ideaSan && (
            <>
              <dt>{t('review.myIdea')}</dt>
              <dd>
                <button className="move-link" onClick={() => props.onPlay(review.my_idea!)} title={t('review.playIt')}>
                  {ideaSan}
                </button>
                <EvalBadge ev={evals[review.my_idea!]} />
              </dd>
            </>
          )}
        </dl>
        {(review.tags.length > 0 || review.source_url || review.game_date) && (
          <div className="review-meta">
            {review.tags.map((tag) => (
              <span key={tag} className="tag-chip static">
                {tag}
              </span>
            ))}
            {review.game_date && <span className="muted small">{formatDate(review.game_date)}</span>}
            {review.source_url && (
              <a className="small" href={review.source_url} target="_blank" rel="noreferrer noopener">
                {t('review.openSource')} ↗
              </a>
            )}
          </div>
        )}
        {review.notes.length > 0 && (
          <ol className="note-list">
            {review.notes.map((n) => (
              <li key={n.id}>
                <span className="note-date">{formatDate(n.created_at)}</span>
                <p>{n.body}</p>
                <button
                  className="note-delete"
                  aria-label={t('review.deleteNote')}
                  title={t('review.deleteNote')}
                  onClick={() => {
                    if (window.confirm(t('review.deleteNoteConfirm'))) run(() => deleteReviewNote(review.id, n.id))
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        <form
          className="note-add"
          onSubmit={async (e) => {
            e.preventDefault()
            if (note.trim() && (await run(() => addReviewNote(review.id, note)))) setNote('')
          }}
        >
          <textarea
            className="note-input"
            rows={2}
            value={note}
            maxLength={4000}
            placeholder={t('review.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="secondary" disabled={busy || !note.trim()}>
            {t('review.addNote')}
          </button>
        </form>
        <div className="review-actions">
          <button
            className={`secondary ${review.reviewed_at ? 'done' : ''}`}
            disabled={busy}
            onClick={() => run(() => updateReview(review.id, { reviewed: !review.reviewed_at }))}
            title={review.reviewed_at ? t('review.markUndone') : t('review.markDoneTitle')}
          >
            {review.reviewed_at ? `✓ ${t('review.done')}` : t('review.markDone')}
          </button>
          <button className="link-btn" onClick={() => openForm()}>
            {t('review.edit')}
          </button>
          <button
            className="link-btn"
            onClick={() => {
              if (window.confirm(t('review.deleteConfirm'))) run(async () => (await deleteReview(review.id), null))
            }}
          >
            {t('review.delete')}
          </button>
        </div>
      </>
    )
  }

  return (
    <section ref={ref} className="panel review-panel sec-rose">
      <div className="panel-head">
        <h2>{t('review.title')}</h2>
        {review && !draft && <span className="saved-badge">★ {t('review.saved')}</span>}
      </div>
      {body}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
