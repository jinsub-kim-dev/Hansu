import { Chess } from 'chess.js'
import { useMemo } from 'react'
import { Chessboard } from 'react-chessboard'
import type { Color, MoveStatGroup } from '../api/client'
import { BoardHelp } from './BoardHelp'
import { MoveArrows } from './MoveArrows'

interface Props {
  fen: string
  orientation: Color
  group: MoveStatGroup | null
  arrowColorOf: (uci: string) => string
  highlighted: string | null
  bestMove: string | null
  pinned?: { uci: string; color: string } | null // 복기 노트에 보관한 내 수
  onMove: (from: string, to: string) => boolean
}

// 체크당한 킹 칸에 까는 붉은 빛 (Lichess처럼 칸 가운데에서 퍼지는 방사형).
const CHECK_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(ellipse at center, rgba(255, 0, 0, 1) 0%, rgba(231, 0, 0, 1) 25%, rgba(169, 0, 0, 0) 89%, rgba(158, 0, 0, 0) 100%)',
}
const MATE_STYLE: React.CSSProperties = {
  background:
    'radial-gradient(ellipse at center, rgba(255, 0, 0, 1) 0%, rgba(200, 0, 0, 1) 45%, rgba(140, 0, 0, 0.85) 80%, rgba(120, 0, 0, 0.7) 100%)',
  boxShadow: 'inset 0 0 0 3px rgba(120, 0, 0, 0.9)',
}

/** 둘 차례인 쪽이 체크면 그 킹 칸의 스타일. */
function checkSquareStyles(fen: string): Record<string, React.CSSProperties> {
  try {
    const chess = new Chess(fen)
    if (!chess.inCheck()) return {}
    const [king] = chess.findPiece({ type: 'k', color: chess.turn() })
    return king ? { [king]: chess.isCheckmate() ? MATE_STYLE : CHECK_STYLE } : {}
  } catch {
    return {}
  }
}

export function StatsBoard({ fen, orientation, group, arrowColorOf, highlighted, bestMove, pinned, onMove }: Props) {
  const squareStyles = useMemo(() => checkSquareStyles(fen), [fen])
  return (
    <div className="board-wrap">
      <Chessboard
        options={{
          id: 'explorer',
          position: fen,
          boardOrientation: orientation,
          squareStyles,
          animationDurationInMs: 150,
          onPieceDrop: ({ sourceSquare, targetSquare }) =>
            targetSquare ? onMove(sourceSquare, targetSquare) : false,
        }}
      />
      <MoveArrows
        moves={group?.moves ?? []}
        total={group?.total ?? 0}
        orientation={orientation}
        colorOf={arrowColorOf}
        highlighted={highlighted}
        bestMove={bestMove}
        pinned={pinned}
      />
      <BoardHelp />
    </div>
  )
}
