// 체스닷컴 분석 사이드바처럼 엔진 후보 수를 평가치와 수순으로 보여준다.
import type { PositionEval } from '../api/client'
import { formatEval } from '../lib/eval'

interface Props {
  fen: string
  evaluation: PositionEval | null
  onPlay: (uci: string) => void
  onHover: (uci: string | null) => void
}

/** SAN 수순에 수 번호를 붙인다. 흑 차례에서 시작하면 "12... Nf6"처럼 시작한다. */
function numbered(fen: string, sans: string[]): string[] {
  const [, turn, , , , full] = fen.split(' ')
  let moveNo = Number(full) || 1
  let white = turn === 'w'
  return sans.map((san, i) => {
    const prefix = white ? `${moveNo}. ` : i === 0 ? `${moveNo}... ` : ''
    if (!white) moveNo += 1
    white = !white
    return prefix + san
  })
}

export function EnginePanel({ fen, evaluation, onPlay, onHover }: Props) {
  const pos = evaluation?.position
  let body: React.ReactNode
  if (!evaluation) {
    body = <p className="body-text muted">분석 요청 중…</p>
  } else if (evaluation.status === 'unavailable' || evaluation.status === 'failed') {
    body = <p className="error">{evaluation.message}</p>
  } else if (!pos) {
    body = <p className="body-text muted">{evaluation.message ?? '분석 중…'}</p>
  } else {
    body = (
      <ol className="engine-lines" onMouseLeave={() => onHover(null)}>
        {pos.lines.map((line) => {
          const whiteAhead = line.mate !== null ? line.mate > 0 : line.cp >= 0
          return (
            <li key={line.uci}>
              <button
                className="engine-line"
                onClick={() => onPlay(line.uci)}
                onMouseEnter={() => onHover(line.uci)}
                title={`${numbered(fen, line.pv_san).join(' ')}
클릭하면 이 수를 둡니다`}
              >
                <span className={`eval-chip ${whiteAhead ? 'white' : 'black'}`}>
                  {formatEval(line.cp, line.mate)}
                </span>
                <span className="line-moves">
                  {numbered(fen, line.pv_san).map((m, i) => (
                    <span key={i} className={i === 0 ? 'first' : undefined}>
                      {m}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <section className="insight-section engine sec-violet">
      <header className="section-head">
        <h3 className="section-title">엔진</h3>
        <span className="section-meta">
          {evaluation?.status === 'pending' && <span className="spinner" aria-label="분석 중" />}
          Stockfish{evaluation?.depth ? ` · 깊이 ${evaluation.depth}` : ''}
        </span>
      </header>
      <div className="section-body">{body}</div>
    </section>
  )
}
