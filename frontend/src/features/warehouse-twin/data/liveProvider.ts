import { z } from 'zod'
import {
  ProviderError,
  type Actor,
  type ConnectionState,
  type TwinDataProvider,
} from './provider'
import {
  auditEventSchema,
  createDisruptionInputSchema,
  decisionInputSchema,
  disruptionSchema,
  equipmentSchema,
  inventoryLotSchema,
  recoveryBundleSchema,
  shipmentSchema,
  twinEventSchema,
  warehouseLayoutSchema,
  type CreateDisruptionInput,
  type DecisionInput,
  type TwinEvent,
} from './schemas'

export interface LiveProviderOptions {
  baseUrl: string
  /** Defaults to baseUrl with ws(s):// and /ws/events */
  wsUrl?: string
  getToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  webSocketImpl?: typeof WebSocket
}

const MAX_BACKOFF_MS = 30_000

export function deriveWsUrl(baseUrl: string): string {
  const url = new URL('/ws/events', baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

/** Reads from the StockRescue backend REST API and /ws/events stream. */
export class LiveProvider implements TwinDataProvider {
  readonly mode = 'live' as const

  private readonly baseUrl: string
  private readonly wsUrl: string
  private readonly getToken: () => Promise<string | null>
  private readonly fetchImpl: typeof fetch
  private readonly WebSocketImpl: typeof WebSocket | undefined

  private socket: WebSocket | null = null
  private connection: ConnectionState = 'closed'
  private retry = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly listeners = new Set<(e: TwinEvent) => void>()
  private readonly connectionListeners = new Set<(s: ConnectionState) => void>()

  constructor(options: LiveProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.wsUrl = options.wsUrl ?? deriveWsUrl(this.baseUrl)
    this.getToken = options.getToken
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
    this.WebSocketImpl = options.webSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
  }

  // ── REST ───────────────────────────────────────────────

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const endpoint = `${init.method ?? 'GET'} ${path.split('?')[0]}`
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    const token = await this.getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers })
    } catch (err) {
      throw new ProviderError('network', `Unable to reach ${this.baseUrl} (${(err as Error).message})`, endpoint)
    }

    const text = await res.text()
    if (!res.ok) {
      const detail = extractDetail(text) ?? (res.statusText || `HTTP ${res.status}`)
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        throw new ProviderError('unavailable', detail, endpoint, res.status)
      }
      if (res.status === 401) throw new ProviderError('unauthorized', detail, endpoint, 401)
      if (res.status === 403) throw new ProviderError('forbidden', detail, endpoint, 403)
      throw new ProviderError('server', detail, endpoint, res.status)
    }

    let json: unknown = null
    if (text.trim()) {
      if (text.trim().startsWith('<')) {
        throw new ProviderError('invalid', 'Received HTML instead of JSON', endpoint, res.status)
      }
      try {
        json = JSON.parse(text)
      } catch {
        throw new ProviderError('invalid', 'Malformed JSON response', endpoint, res.status)
      }
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      throw new ProviderError('invalid', `Response failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`, endpoint, res.status)
    }
    return parsed.data
  }

  getLayout() { return this.request('/api/warehouse/layout', warehouseLayoutSchema) }
  getInventory() { return this.request('/api/inventory', z.array(inventoryLotSchema)) }
  searchInventory(sku: string) {
    return this.request(`/api/inventory/search?sku=${encodeURIComponent(sku)}`, z.array(inventoryLotSchema))
  }
  getDisruptions() { return this.request('/api/disruptions', z.array(disruptionSchema)) }
  getRecovery(disruptionId: string) {
    return this.request(`/api/recovery/${encodeURIComponent(disruptionId)}`, recoveryBundleSchema)
  }
  getShipments() { return this.request('/api/shipments', z.array(shipmentSchema)) }
  getEquipment() { return this.request('/api/equipment', z.array(equipmentSchema)) }
  getAudit() { return this.request('/api/audit', z.array(auditEventSchema)) }

  // Role is enforced by the server from the bearer token; `actor` is not sent.
  createDisruption(input: CreateDisruptionInput, _actor: Actor) {
    void _actor
    const body = createDisruptionInputSchema.parse(input)
    return this.request('/api/disruptions', disruptionSchema, { method: 'POST', body: JSON.stringify(body) })
  }

  async analyzeRecovery(disruptionId: string, _actor: Actor) {
    void _actor
    await this.request(`/api/recovery/${encodeURIComponent(disruptionId)}/analyze`, z.unknown(), { method: 'POST' })
  }

  async approveRecovery(disruptionId: string, input: DecisionInput, _actor: Actor) {
    void _actor
    const body = decisionInputSchema.parse(input)
    await this.request(`/api/recovery/${encodeURIComponent(disruptionId)}/approve`, z.unknown(), {
      method: 'POST', body: JSON.stringify(body),
    })
  }

  async rejectRecovery(disruptionId: string, input: DecisionInput, _actor: Actor) {
    void _actor
    const body = decisionInputSchema.parse(input)
    await this.request(`/api/recovery/${encodeURIComponent(disruptionId)}/reject`, z.unknown(), {
      method: 'POST', body: JSON.stringify(body),
    })
  }

  // ── Event stream ───────────────────────────────────────

  subscribe(listener: (event: TwinEvent) => void): () => void {
    this.listeners.add(listener)
    this.ensureSocket()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.connectionListeners.size === 0) this.closeSocket()
    }
  }

  subscribeConnection(listener: (state: ConnectionState) => void): () => void {
    this.connectionListeners.add(listener)
    listener(this.connection)
    this.ensureSocket()
    return () => {
      this.connectionListeners.delete(listener)
      if (this.listeners.size === 0 && this.connectionListeners.size === 0) this.closeSocket()
    }
  }

  getConnectionState(): ConnectionState {
    return this.connection
  }

  private setConnection(state: ConnectionState) {
    if (this.connection === state) return
    this.connection = state
    this.connectionListeners.forEach(l => l(state))
  }

  private ensureSocket() {
    if (this.socket || this.reconnectTimer || this.disposed) return
    if (!this.WebSocketImpl) {
      this.setConnection('unavailable')
      return
    }
    void this.openSocket()
  }

  private async openSocket() {
    if (!this.WebSocketImpl || this.disposed) return
    this.setConnection(this.retry === 0 ? 'connecting' : 'reconnecting')
    const token = await this.getToken()
    const url = new URL(this.wsUrl)
    if (token) url.searchParams.set('token', token)

    let opened = false
    const socket = new this.WebSocketImpl(url.toString())
    this.socket = socket

    socket.onopen = () => {
      opened = true
      this.retry = 0
      this.setConnection('open')
    }
    socket.onmessage = msg => {
      let json: unknown
      try {
        json = JSON.parse(typeof msg.data === 'string' ? msg.data : '')
      } catch {
        return
      }
      const parsed = twinEventSchema.safeParse(json)
      // Malformed or unknown events are dropped rather than partially applied
      if (parsed.success) this.listeners.forEach(l => l(parsed.data))
    }
    socket.onclose = ev => {
      this.socket = null
      if (this.disposed || (this.listeners.size === 0 && this.connectionListeners.size === 0)) {
        this.setConnection('closed')
        return
      }
      // A socket that never opened and closed with "not found"-like codes means no stream on this backend
      if (!opened && this.retry >= 2 && (ev.code === 1006 || ev.code === 1002 || ev.code === 1008)) {
        this.setConnection('unavailable')
      } else {
        this.setConnection('reconnecting')
      }
      this.scheduleReconnect()
    }
    socket.onerror = () => {
      // onclose follows and handles reconnection
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retry)
    this.retry += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.openSocket()
    }, delay)
  }

  private closeSocket() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.retry = 0
    const s = this.socket
    this.socket = null
    if (s) {
      s.onclose = null
      s.close()
    }
    this.setConnection('closed')
  }

  dispose() {
    this.disposed = true
    this.closeSocket()
    this.listeners.clear()
    this.connectionListeners.clear()
  }
}

function extractDetail(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text)
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
      return JSON.stringify(detail)
    }
  } catch {
    // not JSON
  }
  return null
}
