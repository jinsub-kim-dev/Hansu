// 착수음. public/sounds의 녹음 파일을 Web Audio로 재생한다(처음 한 번 디코딩해 두어 지연이 없다).
// 음원 출처와 라이선스는 public/sounds/*/LICENSE.txt 참고.
export type MoveSound = 'move' | 'capture' | 'castle' | 'check' | 'mate'
export type SoundSet = 'wood' | 'sfx' | 'off'

export const SOUND_SETS: { value: SoundSet; label: string }[] = [
  { value: 'wood', label: '나무 말' },
  { value: 'sfx', label: '효과음' },
  { value: 'off', label: '끄기' },
]

// 소리 종류별로 함께 낼 파일.
type Files = (kind: MoveSound) => string[]

const FILES: Record<Exclude<SoundSet, 'off'>, Files> = {
  // 백·흑 구분 없이 모두 흑 진영 녹음을 쓴다. 잡기는 착수음과 다른 별도 녹음.
  wood: (kind) => {
    switch (kind) {
      case 'move':
        return ['wood/move.mp3']
      case 'capture':
        return ['wood/capture.mp3']
      case 'castle':
        return ['wood/castle.mp3']
      case 'check':
      case 'mate':
        return ['wood/move.mp3', 'wood/check.mp3']
    }
  },
  sfx: (kind) => {
    switch (kind) {
      case 'move':
      case 'castle':
        return ['sfx/Move.mp3']
      case 'capture':
        return ['sfx/Capture.mp3']
      case 'check':
        return ['sfx/Check.mp3']
      case 'mate':
        return ['sfx/Checkmate.mp3']
    }
  },
}

const SET_KEY = 'chess-review:sound-set'

let ctx: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function load(ac: AudioContext, file: string): Promise<AudioBuffer | null> {
  let p = buffers.get(file)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}sounds/${file}`)
      .then((r) => r.arrayBuffer())
      .then((data) => ac.decodeAudioData(data))
      .catch(() => null) // 못 불러오면 소리 없이 넘어간다.
    buffers.set(file, p)
  }
  return p
}

export function soundForSan(san: string): MoveSound {
  if (san.includes('#')) return 'mate'
  if (san.includes('+')) return 'check'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

export function getSoundSet(): SoundSet {
  try {
    const v = localStorage.getItem(SET_KEY)
    return v === 'wood' || v === 'sfx' || v === 'off' ? v : 'wood'
  } catch {
    return 'wood'
  }
}

export function setSoundSet(set: SoundSet) {
  try {
    localStorage.setItem(SET_KEY, set)
  } catch {
    // 저장소를 못 쓰면 이번 세션에서만 적용된다.
  }
}

/** 소리 파일을 미리 디코딩해 첫 착수음이 늦게 나지 않게 한다. */
export function preloadSounds() {
  const set = getSoundSet()
  const ac = audio()
  if (set === 'off' || !ac) return
  for (const kind of ['move', 'capture', 'castle', 'check', 'mate'] as const)
    for (const f of FILES[set](kind)) void load(ac, f)
}

export function playMoveSound(kind: MoveSound) {
  const set = getSoundSet()
  if (set === 'off') return
  const ac = audio()
  if (!ac) return
  for (const file of FILES[set](kind)) {
    void load(ac, file).then((buf) => {
      if (!buf) return
      const src = ac.createBufferSource()
      src.buffer = buf
      src.connect(ac.destination)
      src.start()
    })
  }
}
