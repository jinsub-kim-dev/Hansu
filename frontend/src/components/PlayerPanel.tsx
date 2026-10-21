// 내 계정: 플랫폼 계정을 OAuth로 연결하고, 연결된 계정의 대국을 가져오거나 업데이트한다.
// 체스닷컴은 OAuth 승인 전까지 아이디로 가져오는 방식을 함께 둔다.
import { useEffect, useRef, useState } from 'react'
import {
  getAuthProviders,
  getImportJob,
  getImportSettings,
  getMe,
  getPlayer,
  listPlayers,
  logout,
  startImport,
  startLogin,
  unlinkAccount,
  type AuthProvider,
  type ImportJob,
  type ImportProgress,
  type Me,
  type Platform,
  PLATFORMS,
  platformLabel,
  type PlayerSummary,
  type SavedPlayer,
} from '../api/client'

const POLL_MS = 1000

interface Props {
  current: PlayerSummary | null
  onSelect: (summary: PlayerSummary) => void
  initialJobId: string | null // OAuth로 돌아온 직후 시작된 가져오기 작업
  authError: string | null
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ko-KR') : '-'
}

function Badge({ platform }: { platform: Platform }) {
  return (
    <span className={`platform-badge ${platform}`} title={platformLabel(platform)}>
      {PLATFORMS.find((p) => p.value === platform)?.short}
    </span>
  )
}

export function PlayerPanel({ current, onSelect, initialJobId, authError }: Props) {
  const [me, setMe] = useState<Me | null>(null)
  const [providers, setProviders] = useState<AuthProvider[]>([])
  const [saved, setSaved] = useState<SavedPlayer[]>([])
  const [historyYears, setHistoryYears] = useState(3)
  const [job, setJob] = useState<ImportJob | null>(null)
  const [error, setError] = useState<string | null>(authError)
  const [fallbackName, setFallbackName] = useState('')
  const timer = useRef<number | undefined>(undefined)

  const busy = job?.status === 'queued' || job?.status === 'running'

  function refresh() {
    getMe().then(setMe).catch((e) => setError((e as Error).message))
    listPlayers().then(setSaved).catch((e) => setError((e as Error).message))
  }

  useEffect(() => {
    refresh()
    getAuthProviders().then(setProviders).catch(() => {})
    getImportSettings()
      .then((s) => setHistoryYears(s.history_years))
      .catch(() => {})
    if (initialJobId) poll(initialJobId)
    return () => window.clearTimeout(timer.current)
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function select(platform: Platform, name: string) {
    setError(null)
    try {
      onSelect(await getPlayer(platform, name))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function poll(id: string) {
    try {
      const j = await getImportJob(id)
      setJob(j)
      if (j.status === 'done') {
        refresh()
        await select(j.platform, j.username)
      } else if (j.status === 'error') {
        setError(j.error)
        refresh()
      } else {
        timer.current = window.setTimeout(() => poll(id), POLL_MS)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function runImport(platform: Platform, name: string) {
    if (!name || busy) return
    setError(null)
    try {
      const j = await startImport(platform, name)
      setJob(j)
      poll(j.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function onLogout() {
    await logout()
    refresh()
  }

  async function onUnlink(platform: Platform) {
    if (!window.confirm(`${platformLabel(platform)} 계정 연결을 끊을까요? 가져온 대국 데이터는 남습니다.`)) return
    await unlinkAccount(platform)
    refresh()
  }

  const savedOf = (platform: Platform, username: string) =>
    saved.find((s) => s.platform === platform && s.username === username)
  const linkedKeys = new Set((me?.accounts ?? []).map((a) => `${a.platform}/${a.username}`))
  const others = saved.filter((s) => !linkedKeys.has(`${s.platform}/${s.username}`))
  const isCurrent = (platform: Platform, username: string) =>
    current?.platform === platform && current.username === username
  const p = job?.progress

  return (
    <section className="panel player-panel sec-blue">
      <div className="panel-head">
        <h2>내 계정</h2>
        {me?.user_id != null && (
          <button className="link-btn" onClick={onLogout}>
            로그아웃
          </button>
        )}
      </div>

      <ul className="accounts">
        {PLATFORMS.map(({ value: platform, label }) => {
          const account = me?.accounts.find((a) => a.platform === platform)
          const provider = providers.find((x) => x.platform === platform)
          if (account) {
            const s = savedOf(platform, account.username)
            const hasGames = (s?.total_games ?? 0) > 0
            return (
              <li key={platform} className={isCurrent(platform, account.username) ? 'account active' : 'account'}>
                <button className="pick" onClick={() => select(platform, account.username)}>
                  <span className="name">
                    <Badge platform={platform} />
                    {account.display_name ?? account.username}
                  </span>
                  <span className="muted small">
                    {hasGames
                      ? `${s!.total_games.toLocaleString()}국 · 마지막 대국 ${formatDate(s!.last_game_at)}`
                      : '아직 가져온 대국이 없어요'}
                  </span>
                </button>
                <div className="account-actions">
                  <button
                    className="secondary"
                    onClick={() => runImport(platform, account.username)}
                    disabled={busy}
                    title={hasGames ? '마지막 대국 이후 새 대국을 받습니다' : `최근 ${historyYears}년치 대국을 받습니다`}
                  >
                    {hasGames ? '↻ 업데이트' : '가져오기'}
                  </button>
                  <button className="link-btn" onClick={() => onUnlink(platform)}>
                    연결 해제
                  </button>
                </div>
              </li>
            )
          }
          return (
            <li key={platform} className="account empty">
              <button
                className="connect-btn"
                onClick={() => startLogin(platform)}
                disabled={!provider?.enabled || busy}
              >
                <Badge platform={platform} />
                {label} 계정 연결
              </button>
              {provider && !provider.enabled && (
                <p className="muted small">
                  OAuth 승인 대기 중이에요. 그동안은 아이디로 대국을 가져올 수 있어요.
                </p>
              )}
              {provider && !provider.enabled && (
                <form
                  className="row fallback"
                  onSubmit={(e) => {
                    e.preventDefault()
                    runImport(platform, fallbackName.trim().toLowerCase())
                  }}
                >
                  <input
                    value={fallbackName}
                    onChange={(e) => setFallbackName(e.target.value)}
                    placeholder={`${label} 아이디`}
                    aria-label={`${label} 아이디`}
                    disabled={busy}
                  />
                  <button type="submit" className="secondary" disabled={busy || !fallbackName.trim()}>
                    가져오기
                  </button>
                </form>
              )}
            </li>
          )
        })}
      </ul>
      {me?.user_id == null && (
        <p className="muted small import-hint">
          계정을 연결하면 내 대국을 자동으로 가져옵니다. 처음에는 최근 {historyYears}년치, 이후에는 새 대국만 받아요.
        </p>
      )}

      {p && busy && job && <ImportProgressView job={job} progress={p} historyYears={historyYears} />}
      {job?.status === 'done' && p && (
        <p className="muted small import-hint">
          {platformLabel(job.platform)} {job.username}:{' '}
          {p.mode === 'initial'
            ? `최근 ${historyYears}년 대국 ${p.games_added.toLocaleString()}개를 가져왔어요.`
            : p.games_added > 0
              ? `새 대국 ${p.games_added.toLocaleString()}개를 추가했어요.`
              : '새 대국이 없어요. 이미 최신이에요.'}
        </p>
      )}
      {error && <p className="error">{error}</p>}

      {others.length > 0 && (
        <details className="others">
          <summary>다른 플레이어 ({others.length})</summary>
          <ul className="saved-players">
            {others.map((s) => (
              <li key={`${s.platform}/${s.username}`} className={isCurrent(s.platform, s.username) ? 'active' : ''}>
                <button className="pick" onClick={() => select(s.platform, s.username)}>
                  <span className="name">
                    <Badge platform={s.platform} />
                    {s.display_name ?? s.username}
                  </span>
                  <span className="muted small">
                    {s.total_games.toLocaleString()}국 · 마지막 대국 {formatDate(s.last_game_at)}
                  </span>
                </button>
                <button
                  className="secondary refresh"
                  onClick={() => runImport(s.platform, s.username)}
                  disabled={busy}
                  title="새 대국 업데이트"
                  aria-label={`${s.username} 새 대국 업데이트`}
                >
                  ↻
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function ImportProgressView({
  job,
  progress: p,
  historyYears,
}: {
  job: ImportJob
  progress: ImportProgress
  historyYears: number
}) {
  const title =
    p.mode === 'initial'
      ? `${job.username} · 최근 ${historyYears}년 대국 가져오는 중`
      : `${job.username} · ${formatDate(p.since)} 이후 새 대국 확인 중`
  const byMonth = p.archives_total > 0
  return (
    <div className="import-progress">
      <div className="small">{title}</div>
      {byMonth ? <progress value={p.archives_done} max={p.archives_total} /> : <progress />}
      <div className="muted small">
        {byMonth ? `${p.archives_done}/${p.archives_total}개월` : `${p.games_seen.toLocaleString()}국 확인`} · 새 대국{' '}
        {p.games_added.toLocaleString()}개
      </div>
    </div>
  )
}
