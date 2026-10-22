// 포지션의 엔진 평가를 브라우저에서 계산한다.
// 1) Lichess 클라우드 평가에 이미 깊게 분석된 결과가 있으면 그것을 쓰고,
// 2) 없으면 브라우저 Stockfish로 후보 수(MultiPV)를 깊이별로 점점 깊게 보여주며,
// 3) 통계에 나온 수 중 후보 수에 없는 수는 그 수만 따로 탐색해 판정한다.
// 결과는 이 탭이 열려 있는 동안 포지션별로 기억한다.
import { Chess } from 'chess.js'
import { useEffect, useState } from 'react'
import { translate } from '../i18n'
import { cloudEval } from './cloudEval'
import { classify, type PositionEval } from './eval'
import { engineSupported, EngineLoadError, getEngine, MATE_CP, type SearchLine } from './stockfish'

const MULTIPV = 3
const PV_LENGTH = 8
// 휴대폰·태블릿은 느리고 배터리를 쓰므로 얕게 본다.
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
export const LINE_DEPTH = COARSE ? 14 : 18
const MOVE_DEPTH = COARSE ? 12 : 16

interface Entry {
  lines: SearchLine[] // 둘 차례 기준 점수, 좋은 순
  depth: number
  source: 'cloud' | 'local'
  complete: boolean // 목표 깊이까지 끝났는지
  moves: Map<string, SearchLine> // 후보 수에 없는 수를 따로 탐색한 결과
}

const entries = new Map<string, Entry>() // 포지션 키 → 평가

function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/** 엔진 평가. 같은 포지션에서 평가할 수 목록만 바뀌면 새 결과가 올 때까지 이전 결과를 보여준다. */
export function usePositionEval(fen: string, moves: string[]): PositionEval | null {
  const [state, setState] = useState<{ fen: string; data: PositionEval } | null>(null)
  const movesKey = moves.join(',')

  useEffect(() => {
    const ctrl = new AbortController()
    const wanted = movesKey ? movesKey.split(',') : []
    const publish = (status: PositionEval['status'], message: string | null = null) => {
      if (!ctrl.signal.aborted) setState({ fen, data: build(fen, wanted, status, message) })
    }
    analyse(fen, wanted, ctrl.signal, publish).catch((e: Error) => {
      if (e.name === 'AbortError') return
      publish('failed', translate(e instanceof EngineLoadError ? 'engine.loadFailed' : 'engine.failed'))
    })
    return () => ctrl.abort()
  }, [fen, movesKey])

  return state?.fen === fen ? state.data : null
}

async function analyse(
  fen: string,
  wanted: string[],
  signal: AbortSignal,
  publish: (status: PositionEval['status'], message?: string | null) => void,
) {
  const board = new Chess(fen)
  if (board.isGameOver()) return publish('done', translate('engine.gameOver'))
  const key = positionKey(fen)
  let entry = entries.get(key)
  if (!entry) {
    entry = { lines: [], depth: 0, source: 'local', complete: false, moves: new Map() }
    entries.set(key, entry)
  }
  const e = entry
  const covered = (uci: string) => e.lines.some((l) => l.pv[0] === uci) || e.moves.has(uci)
  if (e.complete && wanted.every(covered)) return publish('done')
  publish('pending', engineSupported() ? null : translate('engine.unsupported'))

  if (!e.complete) {
    const legal = board.moves().length
    const cloud = await cloudEval(fen, MULTIPV, signal)
    if (cloud && cloud.depth >= LINE_DEPTH && cloud.lines.length >= Math.min(MULTIPV, legal)) {
      const sign = board.turn() === 'w' ? 1 : -1 // 백 기준 → 둘 차례 기준
      e.lines = cloud.lines.map((l) => {
        const mate = l.mate === null ? null : sign * l.mate
        const cp = mate === null ? sign * l.cp : Math.sign(mate) * (MATE_CP - Math.abs(mate))
        return { depth: cloud.depth, cp, mate, pv: l.pv }
      })
      Object.assign(e, { depth: cloud.depth, source: 'cloud', complete: true })
      publish('pending')
    }
  }

  if (!engineSupported()) return publish(e.complete ? 'done' : 'unavailable', translate('engine.unsupported'))
  const engine = getEngine()

  if (!e.complete) {
    const onInfo = (lines: SearchLine[]) => {
      Object.assign(e, { lines, depth: lines[0]?.depth ?? 0, source: 'local' })
      publish('pending')
    }
    const lines = await engine.search(fen, { depth: LINE_DEPTH, multipv: MULTIPV }, onInfo, signal)
    Object.assign(e, { lines, depth: lines[0]?.depth ?? 0, source: 'local', complete: true })
    publish('pending')
  }

  for (const uci of wanted) {
    if (covered(uci)) continue
    const [line] = await engine.search(fen, { depth: MOVE_DEPTH, searchmoves: [uci] }, () => {}, signal)
    if (line) e.moves.set(uci, line)
    publish('pending')
  }
  publish('done')
}

/** UCI 수순을 SAN으로. 둘 수 없는 수가 나오면 거기서 멈춘다. */
function pvSan(fen: string, pv: string[]): string[] {
  const chess = new Chess(fen)
  const out: string[] = []
  for (const uci of pv.slice(0, PV_LENGTH)) {
    try {
      out.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san)
    } catch {
      break
    }
  }
  return out
}

/** 기억해 둔 평가를 화면에 쓰는 형식(점수는 백 기준)으로 만든다. */
function build(fen: string, wanted: string[], status: PositionEval['status'], message: string | null): PositionEval {
  const e = entries.get(positionKey(fen))
  const sign = fen.split(' ')[1] === 'w' ? 1 : -1 // 둘 차례 기준 → 백 기준
  const whiteMate = (m: number | null) => (m === null ? null : sign * m)
  if (!e || e.lines.length === 0) {
    const loading = status === 'pending' && !message && engineSupported() && !getEngine().isReady
    return {
      status,
      message: message ?? (loading ? translate('engine.loading') : null),
      depth: null,
      source: null,
      position: null,
      moves: [],
    }
  }
  const best = e.lines[0]
  const lines = e.lines
    .map((l) => ({ l, san: pvSan(fen, l.pv) }))
    .filter(({ san }) => san.length > 0)
    .map(({ l, san }) => ({ uci: l.pv[0], san: san[0], cp: sign * l.cp, mate: whiteMate(l.mate), pv_san: san }))
  const moves = wanted.flatMap((uci) => {
    const row = e.lines.find((l) => l.pv[0] === uci) ?? e.moves.get(uci)
    const san = row && pvSan(fen, [uci])[0]
    if (!row || !san) return []
    const { loss, classification } = classify(best.cp, row.cp, uci === best.pv[0])
    return [
      {
        uci,
        san,
        cp: sign * row.cp,
        mate: whiteMate(row.mate),
        cp_loss: Math.max(0, best.cp - row.cp),
        win_chance_loss: loss,
        classification,
      },
    ]
  })
  return {
    status,
    message,
    depth: e.depth,
    source: e.source,
    position: {
      best_uci: best.pv[0] ?? null,
      best_san: lines[0]?.san ?? null,
      cp: sign * best.cp,
      mate: whiteMate(best.mate),
      pv_san: lines[0]?.pv_san ?? [],
      lines,
    },
    moves,
  }
}
