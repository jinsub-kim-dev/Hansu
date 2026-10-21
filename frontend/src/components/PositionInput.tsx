import { useState } from 'react'
import { parsePositionInput, type Line } from '../lib/line'

interface Props {
  onLoad: (line: Line) => void
}

export function PositionInput({ onLoad }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function load() {
    try {
      onLoad(parsePositionInput(text))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="panel sec-amber">
      <h2>포지션 입력</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={'FEN 또는 PGN을 붙여 넣으세요.\n예) 1. e4 e5 2. Nf3 Nc6\n예) rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'}
        spellCheck={false}
      />
      <div className="row">
        <button onClick={load}>불러오기</button>
        <button
          className="secondary"
          onClick={() => {
            setText('')
            setError(null)
            onLoad(parsePositionInput(''))
          }}
        >
          초기 포지션
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
