export interface SceneParams {
  /** Seed for every procedural texture and prop placement */
  seed: number
  /** Disables cinematic moves, pulses and time-driven motion for deterministic frames */
  freeze: boolean
  /** Shows the drei Stats overlay */
  debug: boolean
}

export function parseSceneParams(search: string): SceneParams {
  const q = new URLSearchParams(search)
  const seed = Number.parseInt(q.get('seed') ?? '', 10)
  return {
    seed: Number.isFinite(seed) ? seed : 42,
    freeze: q.get('freeze') === '1' || q.get('freeze') === 'true',
    debug: q.has('debug'),
  }
}

let cached: SceneParams | null = null

export function getSceneParams(): SceneParams {
  if (!cached) cached = parseSceneParams(typeof window === 'undefined' ? '' : window.location.search)
  return cached
}

/** Small deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
