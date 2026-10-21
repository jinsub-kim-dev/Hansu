import { Chess } from 'chess.js'
import type { Line } from '../lib/line'

interface Props {
  line: Line
  ply: number
  onSelect: (ply: number) => void
}

// 이동 버튼: 처음 / 이전 / 다음 / 끝 (키보드 Home ← → End와 같다)
const NAV: {
  label: string
  keyHint: string
  icon: string
  target: (ply: number, len: number) => number
  atEdge: (ply: number, len: number) => boolean
}[] = [
  { label: '처음', keyHint: 'Home', icon: 'M6 5h2v14H6zM19 5v14l-9-7z', target: () => 0, atEdge: (p) => p === 0 },
  { label: '이전', keyHint: '←', icon: 'M16 5v14l-10-7z', target: (p) => p - 1, atEdge: (p) => p === 0 },
  { label: '다음', keyHint: '→', icon: 'M8 5v14l10-7z', target: (p) => p + 1, atEdge: (p, n) => p >= n },
  { label: '끝', keyHint: 'End', icon: 'M16 5h2v14h-2zM5 5v14l9-7z', target: (_, n) => n, atEdge: (p, n) => p >= n },
]

/** 현재 라인의 수순. 수를 클릭하면 그 포지션으로 이동한다. */
export function MoveList({ line, ply, onSelect }: Props) {
  // 시작 포지션이 흑 차례면 첫 수는 "1..." 형식이 된다.
  const start = new Chess(line.startFen)
  const blackFirst = start.turn() === 'b'
  const firstNumber = start.moveNumber()

  // 백·흑 한 수씩을 한 줄로 묶는다. 값은 line.moves의 인덱스, 둔 적 없는 칸은 null.
  const rows: { number: number; white: number | null; black: number | null }[] = []
  line.moves.forEach((_, i) => {
    const idx = i + (blackFirst ? 1 : 0)
    const number = firstNumber + Math.floor(idx / 2)
    if (idx % 2 === 0 || rows.length === 0) rows.push({ number, white: null, black: null })
    rows[rows.length - 1][idx % 2 === 0 ? 'white' : 'black'] = i
  })

  return (
    <div className="move-list sec-indigo">
      <div className="nav">
        {NAV.map(({ label, keyHint, icon, target, atEdge }) => (
          <button
            key={label}
            className="nav-btn"
            onClick={() => onSelect(target(ply, line.moves.length))}
            disabled={atEdge(ply, line.moves.length)}
            aria-label={label}
            title={`${label} (${keyHint})`}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d={icon} />
            </svg>
          </button>
        ))}
      </div>
      {line.moves.length === 0 ? (
        <p className="muted small">보드에서 말을 움직이거나 표의 수를 클릭하세요.</p>
      ) : (
        <ol className="moves">
          {rows.map((row) => (
            <li key={row.number}>
              <span className="num">{row.number}.</span>
              {[row.white, row.black].map((i, col) =>
                i === null ? (
                  <span key={col} className="move empty">{col === 0 && blackFirst ? '…' : ''}</span>
                ) : (
                  <button
                    key={col}
                    className={i + 1 === ply ? 'move current' : 'move'}
                    onClick={() => onSelect(i + 1)}
                  >
                    {line.moves[i].san}
                  </button>
                ),
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
