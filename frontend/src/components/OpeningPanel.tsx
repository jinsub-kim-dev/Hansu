import type { OpeningClassification } from '../api/client'

interface Props {
  data: OpeningClassification | null
  onPlay: (uci: string) => void
}

const MAX_CONTINUATIONS = 10

/** 현재 라인의 오프닝 이름과 이론으로 이어지는 다음 수. */
export function OpeningPanel({ data, onPlay }: Props) {
  const opening = data?.opening
  let status: React.ReactNode = null
  if (opening && data.in_book) status = <span className="status-badge good">이론</span>
  else if (opening) status = <span className="status-badge">이론 이탈 · {data.plies_out_of_book}수</span>

  return (
    <section className="insight-section opening sec-teal">
      <header className="section-head">
        <h3 className="section-title">오프닝</h3>
        {status}
      </header>
      <div className="section-body">
        {opening ? (
          <div className="opening-line" title={`${opening.eco} ${opening.name}`}>
            <span className="eco">{opening.eco}</span>
            <span className="opening-name">{opening.name}</span>
          </div>
        ) : (
          <p className="body-text muted">
            {!data ? '확인 중…' : data.continuations.length > 0 ? '오프닝 시작 전' : '오프닝 이론 밖의 포지션'}
          </p>
        )}
        {data && data.continuations.length > 0 && (
          <div className="field top">
            <span className="field-label">이론 수</span>
            <div className="tag-list">
              {data.continuations.slice(0, MAX_CONTINUATIONS).map((c) => (
                <button key={c.uci} className="move-chip" title={`${c.eco} ${c.name}`} onClick={() => onPlay(c.uci)}>
                  {c.san}
                </button>
              ))}
              {data.continuations.length > MAX_CONTINUATIONS && (
                <span className="more">+{data.continuations.length - MAX_CONTINUATIONS}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
