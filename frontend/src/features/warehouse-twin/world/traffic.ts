import type { NavGraph } from './navGraph'

// Segment and intersection reservation. An agent may move onto an edge only
// while it holds both the edge and the node at its end, so two agents never
// share a segment or meet inside an intersection; others queue behind.

/** Higher wins when several agents request the same resource in one tick. */
export const PRIORITY = { emptyVehicle: 0, loadedVehicle: 1, pedestrian: 2 } as const
export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY]

const edgeKey = (a: string, b: string) => (a < b ? `e:${a}|${b}` : `e:${b}|${a}`)
const nodeKey = (n: string) => `n:${n}`

export interface TrafficAgent {
  id: string
  path: string[]
  /** Index of the node the agent last reached */
  at: number
  /** 0..1 progress along the edge path[at] → path[at + 1] */
  t: number
  speed: number
  priority: Priority
  waiting: boolean
}

export class TrafficManager {
  private readonly holders = new Map<string, string>()

  holderOf(resource: string): string | undefined {
    return this.holders.get(resource)
  }

  /** Grants every resource or none. */
  tryAcquire(agent: string, resources: string[]): boolean {
    if (resources.some(r => {
      const h = this.holders.get(r)
      return h !== undefined && h !== agent
    })) return false
    resources.forEach(r => this.holders.set(r, agent))
    return true
  }

  release(agent: string, resources: string[]) {
    for (const r of resources) if (this.holders.get(r) === agent) this.holders.delete(r)
  }

  releaseAll(agent: string) {
    for (const [r, h] of [...this.holders]) if (h === agent) this.holders.delete(r)
  }

  /** Resources currently held, for assertions. */
  snapshot(): Map<string, string> {
    return new Map(this.holders)
  }
}

export function createAgent(id: string, path: string[], speed: number, priority: Priority): TrafficAgent {
  return { id, path, at: 0, t: 0, speed, priority, waiting: false }
}

/**
 * Advances all agents by dt seconds. Requests are arbitrated by priority
 * (then id for determinism). Returns the agents for chaining.
 */
export function stepTraffic(g: NavGraph, tm: TrafficManager, agents: TrafficAgent[], dt: number): TrafficAgent[] {
  // Every agent always holds the node it stands on
  for (const a of agents) {
    if (a.t === 0) tm.tryAcquire(a.id, [nodeKey(a.path[a.at])])
  }
  const order = [...agents].sort((x, y) => y.priority - x.priority || x.id.localeCompare(y.id))
  for (const a of order) {
    if (a.at >= a.path.length - 1) {
      a.waiting = false
      continue
    }
    const from = a.path[a.at]
    const to = a.path[a.at + 1]
    if (a.t === 0) {
      // Need the edge and the next node before leaving
      if (!tm.tryAcquire(a.id, [edgeKey(from, to), nodeKey(to)])) {
        a.waiting = true
        continue
      }
    }
    a.waiting = false
    const A = g.nodes.get(from)!
    const B = g.nodes.get(to)!
    const len = Math.max(1e-6, Math.hypot(B.x - A.x, B.z - A.z))
    a.t += (a.speed * dt) / len
    if (a.t >= 1) {
      tm.release(a.id, [edgeKey(from, to), nodeKey(from)])
      a.at += 1
      a.t = 0
    }
  }
  return agents
}

export function agentPoint(g: NavGraph, a: TrafficAgent): { x: number; z: number } {
  const A = g.nodes.get(a.path[a.at])!
  const B = g.nodes.get(a.path[Math.min(a.at + 1, a.path.length - 1)])!
  return { x: A.x + (B.x - A.x) * a.t, z: A.z + (B.z - A.z) * a.t }
}

export { edgeKey, nodeKey }
