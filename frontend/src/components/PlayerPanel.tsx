// 내 계정: 플랫폼 계정을 OAuth로 연결하고, 연결된 계정의 대국을 가져오거나 업데이트한다.
// 연결한 계정의 대국만 볼 수 있다(다른 플레이어의 아이디로는 가져오거나 조회할 수 없다).
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
import { useI18n, type MessageKey } from '../i18n'

const POLL_MS = 1000

interface Props {
  current: PlayerSummary | null
  onSelect: (summary: PlayerSummary) => void
  onClear: () => void // 로그아웃·연결 해제로 고른 계정을 더는 볼 수 없을 때
  initialJobId: string | null // OAuth로 돌아온 직후 시작된 가져오기 작업
  authError: string | null // 로그인 실패 코드(백엔드가 ?auth_error=로 넘김)
}

/** 로그인 실패 코드 → 현재 언어 문장 */
function authErrorKey(code: string): MessageKey {
  const key = `authError.${code}`
  const known: string[] = [
    'login_cancelled', 'login_error', 'login_expired', 'login_verify_failed',
    'account_info_failed', 'account_conflict', 'provider_not_ready',
  ]
  return (known.includes(code) ? key : 'authError.unknown') as MessageKey
}

function Badge({ platform }: { platform: Platform }) {
  return (
    <span className={`platform-badge ${platform}`} title={platformLabel(platform)}>
      {PLATFORMS.find((p) => p.value === platform)?.short}
    </span>
  )
}

export function PlayerPanel({ current, onSelect, onClear, initialJobId, authError }: Props) {
  const [me, setMe] = useState<Me | null>(null)
  const [providers, setProviders] = useState<AuthProvider[]>([])
  const [saved, setSaved] = useState<SavedPlayer[]>([])
  const [historyYears, setHistoryYears] = useState(3)
  const [job, setJob] = useState<ImportJob | null>(null)
  const { t, formatDate, formatNumber } = useI18n()
  const [authCode, setAuthCode] = useState<string | null>(authError)
  const [error, setError] = useState<string | null>(null)
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

  // 고른 계정이 내 연결 계정에서 빠지면(로그아웃, 연결 해제) 선택을 푼다.
  useEffect(() => {
    if (me && current && !me.accounts.some((a) => a.platform === current.platform && a.username === current.username)) {
      onClear()
    }
  }, [me, current, onClear])

  async function select(platform: Platform, name: string) {
    setError(null)
    setAuthCode(null)
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
    setAuthCode(null)
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
    if (!window.confirm(t('account.unlinkConfirm', { platform: platformLabel(platform) }))) return
    await unlinkAccount(platform)
    refresh()
  }

  const savedOf = (platform: Platform, username: string) =>
    saved.find((s) => s.platform === platform && s.username === username)
  const isCurrent = (platform: Platform, username: string) =>
    current?.platform === platform && current.username === username
  const p = job?.progress

  return (
    <section className="panel player-panel sec-blue">
      <div className="panel-head">
        <h2>{t('account.title')}</h2>
        {me?.user_id != null && (
          <button className="link-btn" onClick={onLogout}>
            {t('account.logout')}
          </button>
        )}
      </div>

      <ul className="accounts">
        {PLATFORMS.map(({ value: platform }) => {
          const label = platformLabel(platform)
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
                      ? `${t('common.games', { n: formatNumber(s!.total_games), count: s!.total_games })} · ${t('common.lastGame', { date: formatDate(s!.last_game_at) })}`
                      : t('account.noGames')}
                  </span>
                </button>
                <div className="account-actions">
                  <button
                    className="secondary"
                    onClick={() => runImport(platform, account.username)}
                    disabled={busy}
                    title={hasGames ? t('account.updateTitle') : t('account.importTitle', { years: historyYears })}
                  >
                    {hasGames ? t('account.update') : t('account.import')}
                  </button>
                  <button className="link-btn" onClick={() => onUnlink(platform)}>
                    {t('account.unlink')}
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
                {t('account.connect', { platform: label })}
              </button>
              {provider && !provider.enabled && (
                <p className="muted small">{t('account.pending')}</p>
              )}
            </li>
          )
        })}
      </ul>
      {me?.user_id == null && (
        <p className="muted small import-hint">{t('account.hint', { years: historyYears })}</p>
      )}

      {p && busy && job && <ImportProgressView job={job} progress={p} historyYears={historyYears} />}
      {job?.status === 'done' && p && (
        <p className="muted small import-hint">
          {platformLabel(job.platform)} {job.username}:{' '}
          {p.mode === 'initial'
            ? t('account.doneInitial', { years: historyYears, n: formatNumber(p.games_added), count: p.games_added })
            : p.games_added > 0
              ? t('account.doneAdded', { n: formatNumber(p.games_added), count: p.games_added })
              : t('account.doneNone')}
        </p>
      )}
      {authCode && <p className="error">{t(authErrorKey(authCode))}</p>}
      {error && <p className="error">{error}</p>}

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
  const { t, formatDate, formatNumber } = useI18n()
  const title =
    p.mode === 'initial'
      ? t('import.initial', { name: job.username, years: historyYears })
      : t('import.update', { name: job.username, date: formatDate(p.since) })
  const byMonth = p.archives_total > 0
  return (
    <div className="import-progress">
      <div className="small">{title}</div>
      {byMonth ? <progress value={p.archives_done} max={p.archives_total} /> : <progress />}
      <div className="muted small">
        {byMonth
          ? t('import.months', { done: p.archives_done, total: p.archives_total })
          : t('import.seen', { n: formatNumber(p.games_seen), count: p.games_seen })}{' '}
        · {t('import.added', { n: formatNumber(p.games_added) })}
      </div>
    </div>
  )
}
