// 브라우저 안에서 도는 Stockfish(WebAssembly, Web Worker)와 UCI로 대화한다.
// 엔진 파일은 public/engine/에 있고, 처음 쓸 때 한 번 받아 브라우저가 캐시한다.
// 엔진 프로세스는 하나라 탐색을 한 번에 하나씩 차례로 돌린다.

const ENGINE_URL = '/engine/stockfish-18-lite-single.js'
const HASH_MB = 32
export const MATE_CP = 10000

/** 탐색 중간 결과 한 줄. 점수는 둘 차례인 쪽 기준이다. */
export interface SearchLine {
  depth: number
  cp: number // 메이트는 ±(MATE_CP - 수)
  mate: number | null
  pv: string[] // UCI
}

export interface SearchOptions {
  depth: number
  multipv?: number
  searchmoves?: string[] // 이 수들만 탐색
}

interface Job {
  fen: string
  opts: SearchOptions
  onInfo: (lines: SearchLine[]) => void // 깊이마다(모든 후보 수가 같은 깊이에 이르면) 부른다
  resolve: (lines: SearchLine[]) => void
  reject: (err: Error) => void
  signal?: AbortSignal
}

export class EngineLoadError extends Error {}

class StockfishEngine {
  private worker: Worker
  private ready: Promise<void>
  private queue: Job[] = []
  private current: Job | null = null
  private lines = new Map<number, SearchLine>() // multipv 번호 → 최신 줄
  private multipv = 1
  private failed: Error | null = null
  private onLine: ((line: string) => void) | null = null
  /** 엔진 파일을 받아 띄웠는지(처음 방문이면 내려받는 동안 false) */
  isReady = false

  constructor() {
    this.worker = new Worker(ENGINE_URL)
    this.ready = new Promise((resolve, reject) => {
      const fail = (msg: string) => {
        this.failed = new EngineLoadError(msg)
        reject(this.failed)
        for (const job of this.queue.splice(0)) job.reject(this.failed)
      }
      this.worker.onerror = (e) => fail(e.message || 'worker error')
      this.onLine = (line) => {
        if (line === 'uciok') {
          this.send(`setoption name Hash value ${HASH_MB}`)
          this.send('isready')
        } else if (line === 'readyok') {
          this.onLine = (l) => this.handle(l)
          this.isReady = true
          resolve()
        }
      }
    })
    this.worker.onmessage = (e: MessageEvent) => {
      const data = typeof e.data === 'string' ? e.data : String(e.data)
      for (const line of data.split('\n')) if (line) this.onLine?.(line.trim())
    }
    this.send('uci')
    this.ready.then(() => this.next()).catch(() => {})
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd)
  }

  search(
    fen: string,
    opts: SearchOptions,
    onInfo: (lines: SearchLine[]) => void,
    signal?: AbortSignal,
  ): Promise<SearchLine[]> {
    if (this.failed) return Promise.reject(this.failed)
    return new Promise((resolve, reject) => {
      const job: Job = { fen, opts, onInfo, resolve, reject, signal }
      signal?.addEventListener('abort', () => this.cancel(job), { once: true })
      this.queue.push(job)
      this.next()
    })
  }

  private cancel(job: Job) {
    const i = this.queue.indexOf(job)
    if (i >= 0) {
      this.queue.splice(i, 1)
      job.reject(new DOMException('aborted', 'AbortError'))
    } else if (this.current === job) {
      this.send('stop') // bestmove가 오면 handle()이 끝내고 다음 탐색으로 넘어간다.
    }
  }

  private async next() {
    if (this.current || this.failed) return
    await this.ready
    if (this.current) return
    const job = this.queue.shift()
    if (!job) return
    this.current = job
    this.lines.clear()
    this.multipv = job.opts.multipv ?? 1
    this.send(`setoption name MultiPV value ${this.multipv}`)
    this.send(`position fen ${job.fen}`)
    const moves = job.opts.searchmoves?.length ? ` searchmoves ${job.opts.searchmoves.join(' ')}` : ''
    this.send(`go depth ${job.opts.depth}${moves}`)
  }

  private handle(line: string) {
    const job = this.current
    if (!job) return
    if (line.startsWith('bestmove')) {
      this.current = null
      const result = this.sorted()
      if (job.signal?.aborted) job.reject(new DOMException('aborted', 'AbortError'))
      else job.resolve(result)
      this.next()
      return
    }
    if (!line.startsWith('info ') || job.signal?.aborted) return
    const parsed = parseInfo(line)
    if (!parsed) return
    this.lines.set(parsed.multipv, parsed.line)
    // 후보 수가 모두 같은 깊이에 이르렀을 때만 알린다(깊이가 섞인 목록을 보여주지 않게).
    const lines = this.sorted()
    if (parsed.multipv === Math.min(this.multipv, lines.length) && lines.every((l) => l.depth === parsed.line.depth)) {
      job.onInfo(lines)
    }
  }

  private sorted(): SearchLine[] {
    return [...this.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l)
  }
}

/** "info depth 12 ... multipv 2 score cp 31 ... pv e2e4 e7e5" 한 줄을 읽는다. 경계값·pv 없는 줄은 버린다. */
function parseInfo(line: string): { multipv: number; line: SearchLine } | null {
  const t = line.split(' ')
  const at = (key: string) => t.indexOf(key)
  const pvAt = at('pv')
  const scoreAt = at('score')
  if (pvAt < 0 || scoreAt < 0 || at('lowerbound') >= 0 || at('upperbound') >= 0) return null
  const depth = Number(t[at('depth') + 1])
  const multipv = at('multipv') >= 0 ? Number(t[at('multipv') + 1]) : 1
  const kind = t[scoreAt + 1]
  const value = Number(t[scoreAt + 2])
  const mate = kind === 'mate' ? value : null
  const cp = mate === null ? value : Math.sign(mate || -1) * (MATE_CP - Math.abs(mate))
  return { multipv, line: { depth, cp, mate, pv: t.slice(pvAt + 1) } }
}

let engine: StockfishEngine | null = null

/** WebAssembly를 쓸 수 있는 브라우저인지 */
export function engineSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function'
}

/** 엔진(처음 부르면 내려받아 띄운다) */
export function getEngine(): StockfishEngine {
  engine ??= new StockfishEngine()
  return engine
}
