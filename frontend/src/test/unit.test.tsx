import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ApiClientError } from '@/lib/api'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { CommunicationsPage } from '@/pages/CommunicationsPage'
import { AgentsPage } from '@/pages/AgentsPage'
import { WarehouseListFallback } from '@/features/warehouse/WarehouseListFallback'
import type { InventoryRecord } from '@/types/api'

// Mock auth context
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/contexts/AuthContext'
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>

// ─────────────────────────────────────────────────────────
// API Client tests
// ─────────────────────────────────────────────────────────
describe('ApiClientError', () => {
  it('has status and detail', () => {
    const err = new ApiClientError(404, 'resource not found')
    expect(err.status).toBe(404)
    expect(err.detail).toBe('resource not found')
    expect(err.name).toBe('ApiClientError')
    expect(err).toBeInstanceOf(Error)
  })

  it('handles array detail', () => {
    const detail = [{ loc: ['body', 'sku'], type: 'string_pattern_mismatch', msg: 'invalid' }]
    const err = new ApiClientError(422, detail)
    expect(err.detail).toEqual(detail)
    expect(err.message).toBe('Request validation failed')
  })
})

// ─────────────────────────────────────────────────────────
// StatusBadge tests
// ─────────────────────────────────────────────────────────
describe('StatusBadge', () => {
  it.each(['normal', 'low', 'shortage', 'unknown', 'proposed', 'approved', 'revoked', 'expired'] as const)(
    'renders %s with aria-label and symbol',
    (variant) => {
      render(<StatusBadge variant={variant} />)
      const badge = screen.getByRole('generic', { name: /.+/ })
      expect(badge).toBeInTheDocument()
    },
  )

  it('has accessible aria-label on shortage', () => {
    const { container } = render(<StatusBadge variant="shortage" />)
    const el = container.querySelector('[aria-label="Shortage"]')
    expect(el).toBeInTheDocument()
  })

  it('has accessible aria-label on approved', () => {
    const { container } = render(<StatusBadge variant="approved" />)
    const el = container.querySelector('[aria-label="Approved"]')
    expect(el).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────
// EmptyState tests
// ─────────────────────────────────────────────────────────
describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No cases" />)
    expect(screen.getByText('No cases')).toBeInTheDocument()
  })

  it('renders optional description', () => {
    render(<EmptyState title="No cases" description="Try creating one." />)
    expect(screen.getByText('Try creating one.')).toBeInTheDocument()
  })

  it('has aria-live region', () => {
    const { container } = render(<EmptyState title="No cases" />)
    expect(container.querySelector('[aria-live]')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────
// ErrorState tests
// ─────────────────────────────────────────────────────────
describe('ErrorState', () => {
  it('renders error title and message', () => {
    render(<ErrorState title="Failed" message="Connection refused" />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Connection refused')).toBeInTheDocument()
  })

  it('calls onRetry when clicked', () => {
    const onRetry = vi.fn()
    render(<ErrorState onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('has role=alert', () => {
    render(<ErrorState />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('does not render retry when no handler provided', () => {
    render(<ErrorState />)
    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────
// ProtectedRoute tests
// ─────────────────────────────────────────────────────────
describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      session: null, user: null, loading: false,
    })
  })

  it('redirects unauthenticated user', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Protected content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/sign-in" element={<div>Sign in page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
    expect(screen.getByText('Sign in page')).toBeInTheDocument()
  })

  it('shows content when authenticated', () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: 'tok' }, user: { email: 'op@example.com', app_metadata: {} }, loading: false,
    })
    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div>Protected content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    )
    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })

  it('shows 403 when approver role missing', () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: 'tok' },
      user: { email: 'op@example.com', app_metadata: { roles: [] } },
      loading: false,
    })
    render(
      <MemoryRouter>
        <ProtectedRoute requireApprover>
          <div>Approver content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Approver content')).not.toBeInTheDocument()
  })

  it('shows content when approver role present', () => {
    mockUseAuth.mockReturnValue({
      session: { access_token: 'tok' },
      user: { email: 'op@example.com', app_metadata: { roles: ['procurement_approver'] } },
      loading: false,
    })
    render(
      <MemoryRouter>
        <ProtectedRoute requireApprover>
          <div>Approver content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    )
    expect(screen.getByText('Approver content')).toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────
// CommunicationsPage — "NOT SENT" label
// ─────────────────────────────────────────────────────────
describe('CommunicationsPage', () => {
  it('renders DRAFT NOT SENT label', () => {
    render(<CommunicationsPage />)
    expect(screen.getByText(/NOT SENT/i)).toBeInTheDocument()
  })

  it('has no send button', () => {
    render(<CommunicationsPage />)
    expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument()
  })
})

// ─────────────────────────────────────────────────────────
// AgentsPage — Unknown status, no credentials
// ─────────────────────────────────────────────────────────
describe('AgentsPage', () => {
  it('renders 8 mailbox rows', () => {
    render(<MemoryRouter><AgentsPage /></MemoryRouter>)
    const unknownBadges = screen.getAllByText('Unknown')
    expect(unknownBadges.length).toBeGreaterThanOrEqual(8)
  })

  it('does not expose seed or token text', () => {
    const { container } = render(<MemoryRouter><AgentsPage /></MemoryRouter>)
    expect(container.innerHTML).not.toMatch(/seed|private_key|secret/i)
  })

  it('shows shared mailbox note', () => {
    render(<MemoryRouter><AgentsPage /></MemoryRouter>)
    expect(screen.getAllByText(/Shared mailbox/i).length).toBeGreaterThanOrEqual(2)
  })
})

// ─────────────────────────────────────────────────────────
// WarehouseListFallback
// ─────────────────────────────────────────────────────────
const mockInventory: InventoryRecord[] = [
  { sku: 'SKU-001', location: 'A1', available_quantity: 0, required_quantity: 10, shortage: 10, min_stock_level: 5, status: 'shortage' },
  { sku: 'SKU-002', location: 'B2', available_quantity: 20, required_quantity: 5, shortage: 0, min_stock_level: 5, status: 'normal' },
]

describe('WarehouseListFallback', () => {
  it('renders all inventory rows', () => {
    render(<WarehouseListFallback inventory={mockInventory} searchSku="" filterStatus="all" />)
    expect(screen.getByText('SKU-001')).toBeInTheDocument()
    expect(screen.getByText('SKU-002')).toBeInTheDocument()
  })

  it('filters by search SKU', () => {
    render(<WarehouseListFallback inventory={mockInventory} searchSku="SKU-001" filterStatus="all" />)
    expect(screen.getByText('SKU-001')).toBeInTheDocument()
    expect(screen.queryByText('SKU-002')).not.toBeInTheDocument()
  })

  it('filters by status', () => {
    render(<WarehouseListFallback inventory={mockInventory} searchSku="" filterStatus="shortage" />)
    expect(screen.getByText('SKU-001')).toBeInTheDocument()
    expect(screen.queryByText('SKU-002')).not.toBeInTheDocument()
  })

  it('shows empty message when nothing matches', () => {
    render(<WarehouseListFallback inventory={mockInventory} searchSku="NOMATCH" filterStatus="all" />)
    expect(screen.getByText(/No inventory records match/i)).toBeInTheDocument()
  })

  it('has accessible table label', () => {
    render(<WarehouseListFallback inventory={mockInventory} searchSku="" filterStatus="all" />)
    expect(screen.getByRole('table', { name: /warehouse fallback/i })).toBeInTheDocument()
  })
})
