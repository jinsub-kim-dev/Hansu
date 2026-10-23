import { useCallback, useEffect, useState } from 'react'
import { ApiError, lookupReview, type Review } from '../api/client'

interface State {
  fen: string
  review: Review | null
  loginRequired: boolean
}

/** 지금 포지션을 복기 노트에 보관했는지. 로그인하지 않았으면 loginRequired. */
export function useReview(fen: string, refreshKey: unknown) {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    lookupReview(fen, ctrl.signal)
      .then((review) => setState({ fen, review, loginRequired: false }))
      .catch((e) => {
        if (ctrl.signal.aborted) return
        setState({ fen, review: null, loginRequired: e instanceof ApiError && e.status === 401 })
      })
    return () => ctrl.abort()
  }, [fen, refreshKey])

  const current = state?.fen === fen ? state : null
  const setReview = useCallback((review: Review | null) => {
    setState((s) => (s ? { ...s, review } : s))
  }, [])

  return {
    review: current?.review ?? null,
    loginRequired: current?.loginRequired ?? false,
    loading: current === null,
    setReview,
  }
}
