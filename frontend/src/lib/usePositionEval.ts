import { useEffect, useState } from 'react'
import { getPositionEval, type PositionEval } from '../api/client'

const POLL_MS = 700

/** 포지션과 수들의 엔진 평가. 분석이 끝날 때까지(pending) 폴링한다.
 *  같은 포지션에서 평가할 수 목록만 바뀌면 새 결과가 올 때까지 이전 결과를 보여준다. */
export function usePositionEval(fen: string, moves: string[]): PositionEval | null {
  const [state, setState] = useState<{ fen: string; data: PositionEval } | null>(null)
  const movesKey = moves.join(',')

  useEffect(() => {
    const ctrl = new AbortController()
    let timer: number | undefined
    const list = movesKey ? movesKey.split(',') : []

    async function tick() {
      try {
        const data = await getPositionEval(fen, list, ctrl.signal)
        if (ctrl.signal.aborted) return
        setState({ fen, data })
        if (data.status === 'pending') timer = window.setTimeout(tick, POLL_MS)
      } catch (e) {
        if (ctrl.signal.aborted) return
        setState({
          fen,
          data: { status: 'failed', message: (e as Error).message, depth: null, position: null, moves: [] },
        })
      }
    }
    tick()
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [fen, movesKey])

  return state?.fen === fen ? state.data : null
}
