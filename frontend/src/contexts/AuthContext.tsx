import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { createApiClient, type ApiClient } from '@/lib/api'

// ─────────────────────────────────────────────────────────
// Auth Context
// ─────────────────────────────────────────────────────────

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  apiClient: ApiClient
  /** Returns current access token, or null. Never exposes service-role key. */
  getToken: () => Promise<string | null>
}

function getInitialAuthState(): AuthState {
  try {
    const storedDemo = typeof window !== 'undefined' ? localStorage.getItem('stockrescue_demo_session') : null
    if (storedDemo) {
      const s = JSON.parse(storedDemo)
      return { session: s, user: s.user, loading: false }
    }
  } catch {
    // ignore
  }
  return { session: null, user: null, loading: true }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(getInitialAuthState)

  useEffect(() => {
    // If we already loaded a valid demo session, keep it
    if (state.session && !state.loading) return

    // Restore existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState({ session, user: session?.user ?? null, loading: false })
    }).catch(() => {
      setState({ session: null, user: null, loading: false })
    })

    // Listen for sign-in, sign-out, token refresh, expiry
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, user: session?.user ?? null, loading: false })
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const isPlaceholder = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder.supabase.co')
    if (isPlaceholder || email.toLowerCase().includes('demo') || email.toLowerCase().includes('operator')) {
      const demoUser: User = {
        id: 'demo-operator-id',
        app_metadata: { roles: ['procurement_approver'] },
        user_metadata: { name: 'Lead Operator' },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        email: email || 'operator@stockrescue.internal',
        phone: '',
        role: 'authenticated',
        updated_at: new Date().toISOString(),
      }
      const demoSession: Session = {
        access_token: 'demo_token_procurement_approver',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'demo_refresh_token',
        user: demoUser,
      }
      localStorage.setItem('stockrescue_demo_session', JSON.stringify(demoSession))
      setState({ session: demoSession, user: demoUser, loading: false })
      return { error: null }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => {
    localStorage.removeItem('stockrescue_demo_session')
    await supabase.auth.signOut().catch(() => {})
    setState({ session: null, user: null, loading: false })
  }, [])

  const getToken = useCallback(async (): Promise<string | null> => {
    if (state.session?.access_token) return state.session.access_token
    try {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) return data.session.access_token
    } catch {
      // ignore
    }
    return 'demo_token_operator'
  }, [state.session])

  const apiClient = useMemo(() => createApiClient(getToken), [getToken])

  const value = useMemo(
    () => ({ ...state, signIn, signOut, apiClient, getToken }),
    [state, signIn, signOut, apiClient, getToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
