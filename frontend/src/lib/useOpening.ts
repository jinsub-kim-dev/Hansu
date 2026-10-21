import { useEffect, useState } from 'react'
import { getOpening, type OpeningClassification } from '../api/client'

/** 시작 포지션부터 현재 수까지의 라인을 오프닝으로 분류한다. */
export function useOpening(startFen: string, moves: string[]): OpeningClassification | null {
  const key = `${startFen}|${moves.join(',')}`
  const [state, setState] = useState<{ key: string; data: OpeningClassification | null } | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    getOpening(startFen, moves, ctrl.signal)
      .then((data) => setState({ key, data }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ key, data: null })
      })
    return () => ctrl.abort()
    // key가 startFen과 moves를 모두 담고 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // 다음 결과가 올 때까지는 직전 결과를 보여줘 패널이 깜빡이지 않게 한다.
  return state?.data ?? null
}
