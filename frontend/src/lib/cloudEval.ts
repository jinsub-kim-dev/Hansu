// Lichess 클라우드 평가: 많이 나오는 포지션은 Lichess가 이미 깊게 분석해 둔 결과가 있다.
// 브라우저 엔진보다 먼저 물어보고, 있으면 바로 보여준다. 방문자마다 자기 IP로 요청하도록
// (서버 한 곳에서 모아 보내면 Lichess 요청 한도에 걸린다) 이 호출만 브라우저에서 직접 한다.

const CLOUD_URL = 'https://lichess.org/api/cloud-eval'
const BACKOFF_MS = 60_000 // 429를 받으면 이 시간 동안 묻지 않는다

export interface CloudLine {
  cp: number // 백 기준 (메이트면 0, mate를 본다)
  mate: number | null // 백 기준
  pv: string[] // UCI
}

export interface CloudEval {
  depth: number
  lines: CloudLine[]
}

const cache = new Map<string, CloudEval | null>() // 포지션 키 → 결과(없으면 null)
let pausedUntil = 0

/** 포지션 키(FEN 앞 4필드)의 클라우드 평가. 없거나 실패하면 null. */
export async function cloudEval(fen: string, multipv: number, signal?: AbortSignal): Promise<CloudEval | null> {
  const key = fen.split(' ').slice(0, 4).join(' ')
  if (cache.has(key)) return cache.get(key)!
  if (Date.now() < pausedUntil) return null
  try {
    const res = await fetch(`${CLOUD_URL}?${new URLSearchParams({ fen, multiPv: String(multipv) })}`, { signal })
    if (res.status === 429) {
      pausedUntil = Date.now() + BACKOFF_MS
      return null
    }
    if (!res.ok) {
      if (res.status === 404) cache.set(key, null)
      return null
    }
    const body = (await res.json()) as {
      depth: number
      pvs: { moves: string; cp?: number; mate?: number }[]
    }
    const result: CloudEval = {
      depth: body.depth,
      lines: body.pvs.map((p) => ({ cp: p.cp ?? 0, mate: p.mate ?? null, pv: p.moves.split(' ') })),
    }
    cache.set(key, result)
    return result
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return null // 네트워크 오류면 브라우저 엔진만 쓴다
  }
}
