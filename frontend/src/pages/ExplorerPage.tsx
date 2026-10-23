// 포지션 탐색: 주어진 포지션에서 플레이어 본인 또는 상대들이 다음에 둔 수를 화살표로 보여준다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getPlayer,
  getPositionMoves,
  listReviews,
  PLATFORMS,
  type Color,
  type Platform,
  type PlayerSummary,
  type GameDetail,
  type PositionMoveStats,
  type Review,
} from '../api/client'
import { EnginePanel } from '../components/EnginePanel'
import { GameInfo } from '../components/GameInfo'
import { OpeningPanel } from '../components/OpeningPanel'
import { EvalBar } from '../components/EvalBar'
import { MoveList } from '../components/MoveList'
import { PlayerPanel } from '../components/PlayerPanel'
import { PositionInput } from '../components/PositionInput'
import { ReviewPanel } from '../components/ReviewPanel'
import { StatsBoard } from '../components/StatsBoard'
import { periodToQuery } from '../components/PeriodFilter'
import { StatsPanel, type Filters, type Side } from '../components/StatsPanel'
import { moveColor, QUALITY_COLORS } from '../lib/eval'
import { playMoveSound, soundForSan } from '../lib/sound'
import { useOpening } from '../lib/useOpening'
import { usePositionEval } from '../lib/usePositionEval'
import { useReview } from '../lib/useReview'
import { fenAt, initialLine, lineFromUcis, playMove, uciToMove, type Line } from '../lib/line'


// 마지막으로 고른 플레이어를 기억해 새로고침해도 다시 고르지 않아도 되게 한다(이 브라우저에서만).
const LAST_PLAYER_KEY = 'chess-review:last-player'

function readLastPlayer(): { platform: Platform; username: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_PLAYER_KEY) ?? 'null')
    return v && PLATFORMS.some((p) => p.value === v.platform) && typeof v.username === 'string' ? v : null
  } catch {
    return null
  }
}

function writeLastPlayer(s: PlayerSummary | null) {
  try {
    if (s) localStorage.setItem(LAST_PLAYER_KEY, JSON.stringify({ platform: s.platform, username: s.username }))
    else localStorage.removeItem(LAST_PLAYER_KEY)
  } catch {
    // 저장소를 못 쓰면 기억하지 않는다.
  }
}

/** OAuth 로그인에서 돌아오면 붙는 ?linked=&job=&auth_error= 를 읽고 주소창에서 지운다. */
function takeAuthReturn(): { jobId: string | null; error: string | null } {
  const params = new URLSearchParams(window.location.search)
  const result = { jobId: params.get('job'), error: params.get('auth_error') }
  if (params.has('linked') || params.has('job') || params.has('auth_error')) {
    window.history.replaceState(null, '', window.location.pathname)
  }
  return result
}

const SIDE_COLORS: Record<Side, string> = { player: '#2f6fdb', opponent: '#e0592a' }

/** 다른 화면에서 복기 노트나 대국을 열 때 넘기는 요청 (nonce가 바뀔 때마다 이동) */
export interface OpenRequest {
  review?: Review
  game?: GameDetail
  nonce: number
}

const keyOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

interface Props {
  active: boolean // 이 화면이 보이는 중인지 (아니면 키보드 이동을 받지 않는다)
  openRequest: OpenRequest | null
  reviewsVersion: number // 다른 화면에서 노트가 바뀌면 늘어난다
}

export function ExplorerPage({ active, openRequest, reviewsVersion }: Props) {
  const [player, setPlayer] = useState<PlayerSummary | null>(null)
  const playerRef = useRef(player)
  playerRef.current = player
  const [authReturn] = useState(takeAuthReturn)
  const [line, setLine] = useState<Line>(initialLine)
  const [ply, setPly] = useState(0)
  // 탭을 직접 고르면 그 포지션·진영에서만 우선한다. 포지션이나 진영이 바뀌면 자동으로 돌아간다.
  const [filters, setFilters] = useState<Filters>({ period: { mode: 'all' }, timeClasses: [] })
  // 내 진영(기본 백): 보드 아래쪽이 되고, 통계는 내가 이 색을 잡은 대국만 센다.
  const [myColor, setMyColor] = useState<Color>('white')
  const orientation = myColor
  const [stats, setStats] = useState<PositionMoveStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [hoveredLine, setHoveredLine] = useState<string | null>(null) // 엔진 후보 수 위에 올린 마우스
  const [draftMove, setDraftMove] = useState<string | null>(null) // 통계 표에서 보관을 누른 수
  const [game, setGame] = useState<GameDetail | null>(null) // 대국 목록에서 연 대국
  // 왼쪽의 "내 계정"·"포지션 입력"은 대국이나 노트를 열면 접어 수순과 복기 노트 자리를 만든다.
  const [accountOpen, setAccountOpen] = useState(true)
  const [inputOpen, setInputOpen] = useState(true)
  const [gameReviewKeys, setGameReviewKeys] = useState<Set<string>>(new Set()) // 이 대국에서 보관한 포지션

  const fen = fenAt(line, ply)
  const sideToMove: Color = fen.split(' ')[1] === 'w' ? 'white' : 'black'
  // 보드 아래쪽 진영을 "나"로 본다: 내 차례면 내가 둔 수, 상대 차례면 상대들이 둔 수.
  const autoSide: Side = sideToMove === orientation ? 'player' : 'opponent'
  // 통계는 내 진영 대국만 세므로, 이 포지션에서 데이터가 있는 쪽은 차례로 정해진다.
  const side: Side = autoSide

  useEffect(() => {
    const last = readLastPlayer()
    if (!last) return
    getPlayer(last.platform, last.username)
      .then((s) => setPlayer((cur) => cur ?? s))
      .catch(() => {}) // 로그인하지 않았거나 연결을 끊었으면 무시
  }, [])

  useEffect(() => {
    if (!player) return
    const ctrl = new AbortController()
    setError(null)
    getPositionMoves(
      {
        platform: player.platform,
        username: player.username,
        fen,
        timeClasses: filters.timeClasses,
        color: myColor,
        ...periodToQuery(filters.period),
      },
      ctrl.signal,
    )
      .then(setStats)
      .catch((e) => {
        if (!ctrl.signal.aborted) setError((e as Error).message)
      })
    return () => ctrl.abort()
  }, [player, fen, filters, myColor])

  // 다른 포지션의 통계가 남아 있는 동안에는 화살표를 그리지 않는다.
  const fresh = stats && stats.fen.split(' ').slice(0, 4).join(' ') === fen.split(' ').slice(0, 4).join(' ')
  const group = fresh ? stats[side] : null

  // 복기 노트: 지금 포지션을 보관했는지. 로그인 상태나 다른 화면의 변경이 있으면 다시 찾는다.
  const { review, loginRequired, loading: reviewLoading, setReview } = useReview(
    fen,
    `${player?.platform}/${player?.username}/${reviewsVersion}`,
  )

  // 노트를 열면 그 포지션으로, 대국을 열면 대국 처음으로 이동하고 내 진영도 맞춘다.
  useEffect(() => {
    if (!openRequest) return
    setAccountOpen(false)
    setInputOpen(false)
    const { review: r, game: g } = openRequest
    if (g) {
      setGame(g)
      setLine(lineFromUcis(g.start_fen, g.moves))
      setPly(0)
      setMyColor(g.color)
      // 통계도 이 대국의 계정 것으로 본다.
      const username = g.me.toLowerCase()
      const cur = playerRef.current
      if (cur?.platform !== g.platform || cur.username !== username) {
        getPlayer(g.platform, username).then(onPlayerReady).catch(() => {})
      }
    } else if (r) {
      setGame(null)
      const l = lineFromUcis(r.start_fen, r.moves)
      setLine(l)
      setPly(l.moves.length)
      setMyColor(r.color)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest])

  // 이 대국에서 보관한 포지션(대국 주소가 같은 노트)을 수순에 표시한다.
  useEffect(() => {
    if (!game?.url) return setGameReviewKeys(new Set())
    const ctrl = new AbortController()
    listReviews(ctrl.signal)
      .then((list) => setGameReviewKeys(new Set(list.filter((r) => r.source_url === game.url).map((r) => keyOf(r.fen)))))
      .catch(() => {})
    return () => ctrl.abort()
  }, [game, review?.id])
  const markedMoves = useMemo(
    () => new Set(line.moves.map((_, i) => i).filter((i) => gameReviewKeys.has(keyOf(fenAt(line, i))))),
    [line, gameReviewKeys],
  )
  const deviated = !!game && line.moves.map((m) => m.uci).join(' ') !== game.moves.join(' ')

  // 통계에 나온 수(내 수 + 상대 수)와 복기 노트의 수를 엔진으로 평가해 탭을 바꿔도 바로 보이게 한다.
  const evalMoves = useMemo(() => {
    const noted = [review?.my_move, review?.my_idea].filter((u): u is string => !!u)
    if (!fresh) return noted
    const fromStats = [...stats.player.moves, ...stats.opponent.moves]
      .sort((a, b) => b.games - a.games)
      .slice(0, 30)
      .map((m) => m.uci)
    return [...new Set([...noted, ...fromStats])]
  }, [fresh, stats, review])
  const evaluation = usePositionEval(fen, evalMoves)
  const lineUcis = useMemo(() => line.moves.slice(0, ply).map((m) => m.uci), [line, ply])
  const opening = useOpening(line.startFen, lineUcis)
  const bookMoves = useMemo(
    () => new Set((opening?.continuations ?? []).map((c) => c.uci)),
    [opening],
  )
  const moveEvals = useMemo(
    () => Object.fromEntries((evaluation?.moves ?? []).map((m) => [m.uci, m])),
    [evaluation],
  )

  function goTo(target: number) {
    const next = Math.max(0, Math.min(target, line.moves.length))
    // 앞으로 넘길 때는 도착한 수의 소리를 낸다.
    if (next > ply) playMoveSound(soundForSan(line.moves[next - 1].san))
    setPly(next)
  }

  // 키보드로 수순 이동: ←/→ 한 수, Home/End 처음/끝. 입력 중인 칸에서는 무시한다.
  const goToRef = useRef(goTo)
  goToRef.current = goTo
  const plyRef = useRef(ply)
  plyRef.current = ply
  const lengthRef = useRef(line.moves.length)
  lengthRef.current = line.moves.length
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!activeRef.current) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return
      const targets: Record<string, number> = {
        ArrowLeft: plyRef.current - 1,
        ArrowRight: plyRef.current + 1,
        Home: 0,
        End: lengthRef.current,
      }
      if (!(e.key in targets)) return
      e.preventDefault()
      goToRef.current(targets[e.key])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function play(move: Parameters<typeof playMove>[2]): boolean {
    const next = playMove(line, ply, move)
    if (!next) return false
    playMoveSound(soundForSan(next.moves[ply].san))
    setLine(next)
    setPly(ply + 1)
    setHovered(null)
    setHoveredLine(null)
    return true
  }

  function loadLine(l: Line) {
    setGame(null)
    setLine(l)
    setPly(l.moves.length)
  }

  function onPlayerReady(s: PlayerSummary) {
    setPlayer(s)
    writeLastPlayer(s)
    setFilters((f) => ({ ...f, timeClasses: [] }))
  }

  const onPlayerGone = useCallback(() => {
    setPlayer(null)
    setStats(null)
    writeLastPlayer(null)
  }, [])


  return (
    <div className="layout">
      <aside className="side-col side-left">
        <PlayerPanel
          current={player}
          onSelect={onPlayerReady}
          onClear={onPlayerGone}
          initialJobId={authReturn.jobId}
          authError={authReturn.error}
          open={accountOpen}
          onToggle={() => setAccountOpen((o) => !o)}
        />
        <PositionInput onLoad={loadLine} open={inputOpen} onToggle={() => setInputOpen((o) => !o)} />
        {game && (
          <GameInfo
            game={game}
            deviated={deviated}
            onRestore={() => {
              setLine(lineFromUcis(game.start_fen, game.moves))
              setPly((p) => Math.min(p, game.moves.length))
            }}
            onClose={() => setGame(null)}
          />
        )}
        <MoveList
          line={line}
          ply={ply}
          onSelect={goTo}
          marked={markedMoves}
        />
        <ReviewPanel
          fen={fen}
          line={line}
          ply={ply}
          myColor={myColor}
          evaluation={evaluation}
          review={review}
          loginRequired={loginRequired}
          loading={reviewLoading}
          onChange={setReview}
          draftMove={draftMove}
          onDraftUsed={() => setDraftMove(null)}
          onPlay={(uci) => play(uciToMove(uci))}
          onGoTo={goTo}
          game={game}
        />
      </aside>

      <div className="board-col">
        <EvalBar
          cp={evaluation?.position?.cp ?? null}
          mate={evaluation?.position?.mate ?? null}
          orientation={orientation}
        />
        <StatsBoard
          fen={fen}
          orientation={orientation}
          group={group}
          arrowColorOf={(uci) => moveColor(moveEvals[uci]?.classification)}
          highlighted={hovered}
          bestMove={hoveredLine ?? evaluation?.position?.best_uci ?? null}
          pinned={
            review?.my_move
              ? {
                  uci: review.my_move,
                  color:
                    review.classification || moveEvals[review.my_move]
                      ? moveColor(moveEvals[review.my_move]?.classification ?? review.classification)
                      : QUALITY_COLORS.unknown,
                }
              : null
          }
          onMove={(from, to) => play({ from, to, promotion: 'q' })}
        />
      </div>

      <aside className="side-col side-right insight">
        <OpeningPanel data={opening} onPlay={(uci) => play(uciToMove(uci))} />
        <EnginePanel
          fen={fen}
          evaluation={evaluation}
          onPlay={(uci) => play(uciToMove(uci))}
          onHover={setHoveredLine}
        />
        <StatsPanel
          player={player}
          stats={fresh ? stats : null}
          side={side}
          sideColors={SIDE_COLORS}
          sideToMove={sideToMove}
          myColor={myColor}
          onMyColor={setMyColor}
          filters={filters}
          onFilters={setFilters}
          error={error}
          evals={moveEvals}
          evalPending={evaluation?.status === 'pending'}
          bookMoves={bookMoves}
          onHover={setHovered}
          onPick={(uci) => play(uciToMove(uci))}
          onArchive={loginRequired ? undefined : setDraftMove}
        />
      </aside>
    </div>
  )
}
