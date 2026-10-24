import { useState } from 'react'
import { clsx } from 'clsx'
import { CheckCircle2, ChevronDown, Lock, Pause, Play, RotateCcw, SkipForward, XCircle } from 'lucide-react'
import { can, ROLE_LABELS } from '../data/roles'
import { describeProviderError } from '../data/provider'
import type { SimState } from '../data/simProvider'
import type { Disruption, RecoveryPlan } from '../data/schemas'
import { useActor, useRecoveryDecision } from '../hooks/useTwinData'
import { SimulatedTag } from './TwinChrome'
import { formatDate, formatMoney } from './format'

// ── Scenario player ──────────────────────────────────────

const STATUS_COPY: Record<SimState['status'], string> = {
  loading: 'Loading scenario…',
  idle: 'Ready',
  running: 'Running',
  paused: 'Paused',
  awaiting_approval: 'Waiting for human approval',
  completed: 'Scenario complete',
  rejected: 'Plan rejected, scenario ended',
}

interface SimControlsProps {
  state: SimState
  onStart: () => void
  onPause: () => void
  onStep: () => void
  onReset: () => void
}

export function SimControls({ state, onStart, onPause, onStep, onReset }: SimControlsProps) {
  const running = state.status === 'running'
  const ended = state.status === 'completed' || state.status === 'rejected'
  const gated = state.status === 'awaiting_approval'
  const progress = state.totalSteps ? Math.min(100, (state.stepIndex / state.totalSteps) * 100) : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={clsx('text-xs font-semibold', gated ? 'text-[#92400E]' : ended ? 'text-[#166534]' : 'text-[#334155]')} aria-live="polite">
          {STATUS_COPY[state.status]}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-[#64748B]">
          {Math.min(state.stepIndex, state.totalSteps)}/{state.totalSteps}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-[#F1F5F9]" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Scenario progress">
        <div
          className={clsx('h-full rounded-full transition-[width] duration-500 ease-out', gated ? 'bg-[#D97706]' : 'bg-[#1F4FD8]')}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="min-h-8 text-xs text-[#475569]">
        {state.lastStepLabel && <>Last: <span className="font-medium text-[#0F172A]">{state.lastStepLabel}</span><br /></>}
        {!ended && state.nextStepLabel && <>Next: {state.nextStepLabel}</>}
      </p>

      <div className="grid grid-cols-4 gap-1.5">
        {running ? (
          <button type="button" onClick={onPause} className="btn-secondary px-2 py-1.5 text-xs" aria-label="Pause scenario">
            <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Pause
          </button>
        ) : (
          <button type="button" onClick={onStart} disabled={ended || gated || state.status === 'loading'} className="btn-primary px-2 py-1.5 text-xs" aria-label="Start scenario">
            <Play className="h-3.5 w-3.5" aria-hidden="true" /> {state.stepIndex > 0 ? 'Resume' : 'Start'}
          </button>
        )}
        <button type="button" onClick={onStep} disabled={ended || gated || running} className="btn-secondary px-2 py-1.5 text-xs" aria-label="Play next step">
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" /> Step
        </button>
        <button type="button" onClick={onReset} disabled={state.status === 'loading'} className="btn-secondary col-span-2 px-2 py-1.5 text-xs" aria-label="Reset scenario">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset
        </button>
      </div>
    </div>
  )
}

// ── Approval ─────────────────────────────────────────────

interface ApprovalCardProps {
  disruption: Disruption
  plan: RecoveryPlan
  simulated: boolean
}

export function ApprovalCard({ disruption, plan, simulated }: ApprovalCardProps) {
  const actor = useActor()
  const decide = useRecoveryDecision(disruption.id)
  const [optionId, setOptionId] = useState<string | null>(plan.recommendedOptionId)
  const [comment, setComment] = useState('')
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null)
  const [expanded, setExpanded] = useState<string | null>(plan.recommendedOptionId)

  const allowed = can(actor.role, 'approve')
  const selected = plan.options.find(o => o.id === optionId) ?? null
  const commentValid = comment.trim().length > 0

  const submit = (decision: 'approve' | 'reject') => {
    decide.mutate(
      { decision, input: { optionId, comment: comment.trim() } },
      { onSuccess: () => setConfirming(null) },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[#475569]">
          Plan <span className="font-mono font-semibold text-[#0F172A]">{plan.id}</span> · {plan.options.length} options from the recovery agents
        </p>
        {simulated && <SimulatedTag />}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Recovery options</legend>
        {plan.options.map(o => {
          const isSel = o.id === optionId
          const open = expanded === o.id
          return (
            <div
              key={o.id}
              className={clsx(
                'rounded-lg border transition-all duration-200',
                isSel ? 'border-[#1F4FD8] bg-[#F8FAFF] shadow-[0_0_0_3px_rgba(31,79,216,0.12)]' : 'border-[#E2E8F0] hover:border-[#CBD5E1]',
              )}
            >
              <label className="flex cursor-pointer items-start gap-2.5 p-3">
                <input
                  type="radio"
                  name={`option-${plan.id}`}
                  checked={isSel}
                  onChange={() => setOptionId(o.id)}
                  disabled={!allowed || plan.status !== 'awaiting_approval'}
                  className="mt-0.5 accent-[#1F4FD8]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#0F172A]">{o.label}</span>
                    {o.id === plan.recommendedOptionId && (
                      <span className="rounded bg-[#1F4FD8] px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">Recommended</span>
                    )}
                  </span>
                  <span className="mt-1.5 grid grid-cols-3 gap-1.5 text-[11px]">
                    <span className={clsx('rounded px-1.5 py-1', o.withinBudget ? 'bg-[#F0FDF4] text-[#166534]' : 'bg-[#FEF2F2] text-[#991B1B]')}>
                      {o.withinBudget ? '✓' : '✗'} {formatMoney(o.totalCost.amount, o.totalCost.currency)}
                      <span className="block text-[10px] opacity-80">
                        {disruption.budget ? `of ${formatMoney(disruption.budget.amount, disruption.budget.currency)}` : 'no budget set'}
                      </span>
                    </span>
                    <span className={clsx('rounded px-1.5 py-1', o.meetsDeadline ? 'bg-[#F0FDF4] text-[#166534]' : 'bg-[#FEF2F2] text-[#991B1B]')}>
                      {o.meetsDeadline ? '✓' : '✗'} ETA {formatDate(o.eta)}
                      <span className="block text-[10px] opacity-80">due {formatDate(disruption.deadline)}</span>
                    </span>
                    <span className="rounded bg-[#F8FAFC] px-1.5 py-1 text-[#334155]">
                      {Math.round(o.confidence * 100)}% confidence
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[#E2E8F0]">
                        <span className="block h-full rounded-full bg-[#1F4FD8]" style={{ width: `${o.confidence * 100}%` }} />
                      </span>
                    </span>
                  </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : o.id)}
                className="flex w-full items-center gap-1 border-t border-[#F1F5F9] px-3 py-1.5 text-[11px] font-medium text-[#475569] hover:text-[#1F4FD8]"
                aria-expanded={open}
              >
                <ChevronDown className={clsx('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                Reasoning, lines & sources
              </button>
              {open && (
                <div className="animate-fade-in space-y-2 px-3 pb-3 text-[11px] text-[#334155]">
                  <p>{o.reasoning}</p>
                  <ul className="space-y-0.5 font-mono">
                    {o.lines.map(l => (
                      <li key={`${l.supplier.id}-${l.sku}`}>
                        {l.qty} × {l.sku} · {l.supplier.name} @ {formatMoney(l.unitPrice, o.totalCost.currency)}
                      </li>
                    ))}
                  </ul>
                  <ul className="list-disc space-y-0.5 pl-4 text-[#64748B]">
                    {o.sources.map(s => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </fieldset>

      {plan.status !== 'awaiting_approval' ? (
        <p className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium', plan.status === 'approved' ? 'bg-[#F0FDF4] text-[#166534]' : 'bg-[#F1F5F9] text-[#475569]')}>
          {plan.status === 'approved' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          Plan {plan.status}. No purchase is placed by the AI; procurement acts on the approved plan.
        </p>
      ) : !allowed ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-[#F8FAFC] px-3 py-2 text-xs text-[#475569]">
          <Lock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          Only an Approver can approve or reject recovery plans. Your role: {ROLE_LABELS[actor.role]}.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`comment-${plan.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
            Decision comment (required)
          </label>
          <textarea
            id={`comment-${plan.id}`}
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            placeholder="Why this decision?"
            className="input-field resize-none"
          />
          {decide.isError && (
            <p role="alert" className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">
              <strong>{describeProviderError(decide.error).title}:</strong> {describeProviderError(decide.error).detail}
            </p>
          )}
          {confirming ? (
            <div className="animate-pop-in rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#78350F]" role="alertdialog" aria-label="Confirm decision">
              <p className="mb-2">
                {confirming === 'approve'
                  ? <>Approve <strong>{selected?.label ?? 'this plan'}</strong> for {selected ? formatMoney(selected.totalCost.amount, selected.totalCost.currency) : '—'}?</>
                  : <>Reject plan <strong>{plan.id}</strong>?</>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => submit(confirming)}
                  disabled={decide.isPending}
                  className={clsx(confirming === 'approve' ? 'btn-primary' : 'btn-destructive', 'px-3 py-1.5 text-xs')}
                >
                  {decide.isPending ? 'Submitting…' : `Confirm ${confirming}`}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="btn-secondary px-3 py-1.5 text-xs">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={!commentValid || !selected} onClick={() => setConfirming('approve')} className="btn-primary px-3 py-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Approve
              </button>
              <button type="button" disabled={!commentValid} onClick={() => setConfirming('reject')} className="btn-secondary px-3 py-1.5 text-xs text-[#B91C1C]">
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
