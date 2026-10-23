import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center shadow-md my-4 max-w-lg mx-auto"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] shadow-xs">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1.5 max-w-md">
        <p className="font-semibold text-base text-[#0F172A]">{title}</p>
        <p className="text-sm text-[#475569] leading-relaxed break-words">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-clay text-xs mt-2"
        >
          <RefreshCw className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  )
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  handleReset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <ErrorState
            message={this.state.error.message}
            onRetry={this.handleReset}
          />
        )
      )
    }
    return this.props.children
  }
}
