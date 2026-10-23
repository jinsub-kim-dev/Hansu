// 백엔드 API 클라이언트. 외부 플랫폼 API는 직접 호출하지 않는다.
import { getLang, translate } from '../i18n'
import type { Classification } from '../lib/eval'

export type Platform = 'chesscom' | 'lichess'

export const PLATFORMS: { value: Platform; short: string }[] = [
  { value: 'chesscom', short: 'C' },
  { value: 'lichess', short: 'L' },
]

/** 플랫폼 이름(현재 언어) */
export function platformLabel(p: Platform): string {
  return translate(`platform.${p}`)
}
export type Color = 'white' | 'black'

export interface ImportProgress {
  archives_total: number
  archives_done: number
  archives_skipped: number
  games_added: number
  games_seen: number // 받아 본 대국 수 (리체스처럼 월 단위가 없는 플랫폼의 진행률)
  mode: 'initial' | 'update' // initial: 최근 몇 년치 처음 가져오기, update: 마지막 대국 이후만
  since: string | null // 이 시각 이후에 끝난 대국만 가져온다
}

export interface ImportJob {
  id: string
  platform: Platform
  username: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: ImportProgress
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface SavedPlayer {
  platform: Platform
  username: string
  display_name: string | null
  last_imported_at: string | null
  total_games: number
  last_game_at: string | null // 저장된 마지막 대국. 업데이트는 이 이후만 받는다.
}

export interface ImportSettings {
  history_years: number // 처음 가져올 때 받는 기간(년)
}

export interface PlayerSummary {
  platform: Platform
  username: string
  display_name: string | null
  saved: boolean
  last_imported_at: string | null
  total_games: number
  by_time_class: Record<string, number>
  first_game_at: string | null
  last_game_at: string | null
}

export interface MoveStat {
  uci: string
  san: string
  games: number
  wins: number
  draws: number
  losses: number
}

export interface MoveStatGroup {
  total: number
  moves: MoveStat[]
}

export interface PositionMoveStats {
  fen: string
  position_key: string
  side_to_move: Color
  player: MoveStatGroup
  opponent: MoveStatGroup
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 백엔드가 오류 문구를 현재 언어로 만들도록 언어를 함께 보낸다.
  const headers = new Headers(init?.headers)
  headers.set('Accept-Language', getLang())
  const resp = await fetch(`/api${path}`, { ...init, headers })
  if (!resp.ok) {
    let message = translate('error.requestFailed', { status: resp.status })
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      // 본문이 JSON이 아니면 기본 메시지
    }
    throw new ApiError(message, resp.status)
  }
  return resp.json() as Promise<T>
}

const enc = encodeURIComponent

export function startImport(platform: Platform, username: string): Promise<ImportJob> {
  return request(`/players/${platform}/${enc(username)}/import`, { method: 'POST' })
}

export function getImportJob(id: string): Promise<ImportJob> {
  return request(`/import-jobs/${enc(id)}`)
}

export function getImportSettings(): Promise<ImportSettings> {
  return request('/import-settings')
}

export function listPlayers(): Promise<SavedPlayer[]> {
  return request('/players')
}

export function getPlayer(platform: Platform, username: string): Promise<PlayerSummary> {
  return request(`/players/${platform}/${enc(username)}`)
}

export interface PositionQuery {
  platform: Platform
  username: string
  fen: string
  timeClasses?: string[]
  color?: Color
  since?: string // ISO 시각, 이 시각 이후(포함)에 끝난 대국만
  until?: string // ISO 시각, 이 시각 전(미포함)에 끝난 대국만
}

export function getPositionMoves(q: PositionQuery, signal?: AbortSignal): Promise<PositionMoveStats> {
  const params = new URLSearchParams({ platform: q.platform, username: q.username, fen: q.fen })
  for (const tc of q.timeClasses ?? []) params.append('time_class', tc)
  if (q.color) params.set('color', q.color)
  if (q.since) params.set('since', q.since)
  if (q.until) params.set('until', q.until)
  return request(`/stats/position-moves?${params}`, { signal })
}

export interface Opening {
  eco: string
  name: string
}

export interface OpeningContinuation extends Opening {
  uci: string
  san: string
}

export interface OpeningClassification {
  opening: Opening | null // 마지막으로 지나간 이론 포지션의 오프닝
  in_book: boolean // 현재 포지션이 이론 포지션인지
  plies_out_of_book: number
  continuations: OpeningContinuation[] // 이론으로 이어지는 다음 수
}

export function getOpening(startFen: string, moves: string[], signal?: AbortSignal): Promise<OpeningClassification> {
  const params = new URLSearchParams({ fen: startFen })
  for (const m of moves) params.append('moves', m)
  return request(`/openings/classify?${params}`, { signal })
}

// ---- 계정 연결(OAuth 로그인) ----

export interface AuthProvider {
  platform: Platform
  label: string
  enabled: boolean // false면 아직 연결할 수 없다(예: 체스닷컴 OAuth 승인 대기)
}

export interface LinkedAccount {
  platform: Platform
  username: string
  display_name: string | null
  linked_at: string
}

export interface Me {
  user_id: number | null // 로그인 전이면 null
  accounts: LinkedAccount[]
}

export function getMe(): Promise<Me> {
  return request('/me')
}

export function getAuthProviders(): Promise<AuthProvider[]> {
  return request('/auth/providers')
}

/** 플랫폼 로그인 화면으로 이동한다. 돌아오면 ?linked=<platform>&job=<id> 또는 ?auth_error=... 가 붙는다. */
export function startLogin(platform: Platform) {
  window.location.href = `/api/auth/${platform}/login`
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/auth/logout', { method: 'POST' })
}

export function unlinkAccount(platform: Platform): Promise<{ ok: boolean }> {
  return request(`/me/accounts/${platform}`, { method: 'DELETE' })
}

// ---- 복기 노트 (로그인한 사용자 본인의 것) ----

export interface ReviewNote {
  id: number
  body: string
  created_at: string
}

export interface Review {
  id: number
  start_fen: string
  moves: string[] // 시작 포지션부터 이 포지션까지 (UCI)
  fen: string
  color: Color // 내 진영
  my_move: string | null // 내가 둔 수 (UCI)
  my_idea: string | null // 엔진을 보기 전에 내가 생각한 더 좋은 수
  best_move: string | null // 보관할 때의 엔진 최선 수
  classification: Classification | null // 보관할 때의 내 수 판정
  tags: string[]
  source_url: string | null
  game_date: string | null // YYYY-MM-DD
  reviewed_at: string | null // 복기를 마쳤다고 표시한 시각
  created_at: string
  updated_at: string
  notes: ReviewNote[] // 오래된 순
}

export interface ReviewInput {
  start_fen: string
  moves: string[]
  color: Color
  my_move?: string | null
  my_idea?: string | null
  best_move?: string | null
  classification?: Classification | null
  tags?: string[]
  source_url?: string | null
  game_date?: string | null
  note?: string | null
}

export type ReviewPatch = Partial<Omit<ReviewInput, 'start_fen' | 'moves' | 'note'>> & { reviewed?: boolean }

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function listReviews(signal?: AbortSignal): Promise<Review[]> {
  return request('/reviews', { signal })
}

/** 이 포지션을 보관했으면 그 노트, 아니면 null (수순이 달라도 같은 포지션이면 찾는다). */
export function lookupReview(fen: string, signal?: AbortSignal): Promise<Review | null> {
  return request(`/reviews/lookup?${new URLSearchParams({ fen })}`, { signal })
}

export function createReview(input: ReviewInput): Promise<Review> {
  return request('/reviews', json('POST', input))
}

export function updateReview(id: number, patch: ReviewPatch): Promise<Review> {
  return request(`/reviews/${id}`, json('PATCH', patch))
}

export function deleteReview(id: number): Promise<{ ok: boolean }> {
  return request(`/reviews/${id}`, { method: 'DELETE' })
}

export function addReviewNote(id: number, body: string): Promise<Review> {
  return request(`/reviews/${id}/notes`, json('POST', { body }))
}

export function deleteReviewNote(id: number, noteId: number): Promise<Review> {
  return request(`/reviews/${id}/notes/${noteId}`, { method: 'DELETE' })
}

// ---- 대국 목록 / 대국 하나 (연결한 계정의 대국만) ----

export type Outcome = 'win' | 'draw' | 'loss'

export interface GameSummary {
  id: number
  platform: Platform
  url: string | null
  color: Color // 내가 잡은 색
  outcome: Outcome // 내 기준
  result: string
  me: string
  my_rating: number | null
  opponent: string
  opponent_rating: number | null
  time_class: string | null
  time_control: string | null
  rated: boolean | null
  end_time: string | null
  plies: number
  opening: Opening | null
}

export interface GameDetail extends GameSummary {
  start_fen: string
  moves: string[] // UCI
  pgn: string
}

export interface GameQuery {
  timeClasses?: string[]
  color?: Color | null
  outcome?: Outcome | null
  offset?: number
  limit?: number
}

export function listGames(
  platform: Platform,
  username: string,
  q: GameQuery,
  signal?: AbortSignal,
): Promise<{ total: number; games: GameSummary[] }> {
  const params = new URLSearchParams()
  for (const tc of q.timeClasses ?? []) params.append('time_class', tc)
  if (q.color) params.set('color', q.color)
  if (q.outcome) params.set('outcome', q.outcome)
  if (q.offset) params.set('offset', String(q.offset))
  if (q.limit) params.set('limit', String(q.limit))
  return request(`/players/${platform}/${enc(username)}/games?${params}`, { signal })
}

export function getGame(id: number): Promise<GameDetail> {
  return request(`/games/${id}`)
}
