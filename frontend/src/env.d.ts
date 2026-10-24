/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Warehouse twin start mode: 'simulation' (default) or 'live' */
  readonly VITE_TWIN_MODE?: string
  /** Override for the twin event stream URL; defaults to ws(s)://<api>/ws/events */
  readonly VITE_TWIN_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
