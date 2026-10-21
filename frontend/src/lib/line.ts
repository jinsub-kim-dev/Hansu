// 시작 포지션과 그 뒤의 수순(라인)을 다루는 도우미. 보드 상태 계산은 chess.js에 맡긴다.
import { Chess, DEFAULT_POSITION } from 'chess.js'

export interface LineMove {
  san: string
  uci: string
  fen: string // 이 수를 둔 뒤의 FEN
}

export interface Line {
  startFen: string
  moves: LineMove[]
}

export const initialLine: Line = { startFen: DEFAULT_POSITION, moves: [] }

export function fenAt(line: Line, ply: number): string {
  return ply === 0 ? line.startFen : line.moves[ply - 1].fen
}

/** ply 위치에서 수를 둔다. ply 뒤의 수순은 버린다. 둘 수 없는 수면 null. */
export function playMove(
  line: Line,
  ply: number,
  move: string | { from: string; to: string; promotion?: string },
): Line | null {
  const chess = new Chess(fenAt(line, ply))
  try {
    const m = chess.move(move)
    const next: LineMove = { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() }
    return { startFen: line.startFen, moves: [...line.moves.slice(0, ply), next] }
  } catch {
    return null
  }
}

export function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }
}

/** FEN 또는 PGN(헤더 없는 수순 포함)을 라인으로 바꾼다. 해석할 수 없으면 Error. */
export function parsePositionInput(text: string): Line {
  const input = text.trim()
  if (!input) return initialLine

  // FEN은 공백으로 나뉜 첫 칸이 '/'로 8칸 구분된 배치다.
  if (/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/.test(input)) {
    try {
      return { startFen: new Chess(input).fen(), moves: [] }
    } catch (e) {
      throw new Error(`잘못된 FEN입니다: ${(e as Error).message}`)
    }
  }

  const chess = new Chess()
  try {
    chess.loadPgn(input)
  } catch (e) {
    throw new Error(`PGN을 해석할 수 없습니다: ${(e as Error).message}`)
  }
  const history = chess.history({ verbose: true })
  return {
    startFen: history.length ? history[0].before : chess.fen(),
    moves: history.map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: m.after })),
  }
}
