// 백엔드 API 클라이언트. 외부 플랫폼 API는 직접 호출하지 않는다.
import { getLang, translate } from '../i18n'

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

export class ApiError extends Error {}

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
    throw new ApiError(message)
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

export type Classification = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export interface CandidateLine {
  uci: string
  san: string
  cp: number // 백 기준
  mate: number | null
  pv_san: string[]
}

export interface EngineLine {
  best_uci: string | null
  best_san: string | null
  cp: number // 백 기준
  mate: number | null // 백 기준
  pv_san: string[]
  lines: CandidateLine[] // 엔진 후보 수 (좋은 순)
}

export interface MoveEval {
  uci: string
  san: string
  cp: number // 수를 둔 뒤 백 기준
  mate: number | null
  cp_loss: number | null
  win_chance_loss: number | null
  classification: Classification | null
}

export interface PositionEval {
  status: 'done' | 'pending' | 'failed' | 'unavailable'
  message: string | null
  depth: number | null
  position: EngineLine | null
  moves: MoveEval[]
}

export function getPositionEval(fen: string, moves: string[], signal?: AbortSignal): Promise<PositionEval> {
  const params = new URLSearchParams({ fen })
  for (const m of moves) params.append('moves', m)
  return request(`/analysis/position?${params}`, { signal })
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
