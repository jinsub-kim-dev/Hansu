// 플랫폼 표시. 리체스는 공식 로고(lichess.org를 가리킬 때만 쓸 수 있다, public/brands/README.txt),
// 체스닷컴은 로고 사용을 확인하기 전까지 글자 배지를 쓴다.
import { PLATFORMS, platformLabel, type Platform } from '../api/client'

export function PlatformBadge({ platform }: { platform: Platform }) {
  if (platform === 'lichess') {
    return <img className="platform-badge lichess" src="/brands/lichess.svg" alt={platformLabel(platform)} title={platformLabel(platform)} />
  }
  return (
    <span className={`platform-badge ${platform}`} title={platformLabel(platform)}>
      {PLATFORMS.find((p) => p.value === platform)?.short}
    </span>
  )
}
