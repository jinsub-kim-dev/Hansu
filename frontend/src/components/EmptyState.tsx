// 목록 화면(대국, 복기 노트)의 빈 상태: 아이콘 + 제목 + 설명 + 다음 행동 버튼.
import { useEffect, useState, type ReactNode } from 'react'
import { startLogin } from '../api/client'
import { useI18n } from '../i18n'
import { PlatformBadge } from './PlatformBadge'

// 24×24 선 아이콘 경로
const ICONS = {
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  games: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  reviews: 'M6 3h12v18l-6-4-6 4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  import: 'M12 3v12M7 10l5 5 5-5M5 21h14',
}

interface Props {
  icon: keyof typeof ICONS
  tone?: 'blue' | 'teal' | 'rose' | 'muted'
  title: string
  children?: ReactNode // 설명
  actions?: ReactNode
}

export function EmptyState({ icon, tone = 'blue', title, children, actions }: Props) {
  return (
    <div className={`list-empty tone-${tone}`}>
      <span className="empty-icon" aria-hidden>
        <svg viewBox="0 0 24 24">
          <path d={ICONS[icon]} />
        </svg>
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  )
}

/** 로그인하지 않았거나 연결한 계정이 없을 때: 리체스 계정 연결로 안내한다. */
export function ConnectAccountState({ description }: { description: string }) {
  const { t } = useI18n()
  return (
    <EmptyState
      icon="account"
      title={t('empty.connectTitle')}
      actions={
        <>
          <button className="connect-btn" onClick={() => startLogin('lichess')}>
            <PlatformBadge platform="lichess" />
            {t('account.connect', { platform: t('platform.lichess') })}
          </button>
          <span className="muted small">{t('empty.chesscomPending')}</span>
        </>
      }
    >
      {description}
    </EmptyState>
  )
}

/** 불러오는 중. 오래 걸리면 서버가 잠에서 깨는 중일 수 있다고 알려 준다(무료 서버는 쉬다가 첫 요청에 깨어난다). */
export function LoadingState() {
  const { t } = useI18n()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 3000)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <div className="list-empty loading" role="status">
      <span className="spinner big" aria-hidden />
      <h3>{t('reviews.loading')}</h3>
      {slow && <p>{t('empty.waking')}</p>}
    </div>
  )
}
