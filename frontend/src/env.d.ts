/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Warehouse twin start mode: 'simulation' (default) or 'live' */
  readonly VITE_TWIN_MODE?: string
  /** Override for the twin event stream URL; defaults to ws(s)://<api>/ws/events */
  readonly VITE_TWIN_WS_URL?: string
  /** LIVE data older than this many ms is shown as STALE (default 60000) */
  readonly VITE_TWIN_STALE_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
