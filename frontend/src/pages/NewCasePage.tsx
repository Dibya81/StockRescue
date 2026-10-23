import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, Trash2, AlertCircle, ArrowLeft, Send, Briefcase, Layers, Tag, DollarSign } from 'lucide-react'
import { useCreateCase } from '@/hooks/api'
import type { JobRequirement, InventoryRecord, SupplierOffer } from '@/types/api'
import { ApiClientError } from '@/lib/api'

function SectionHeader({ icon: Icon, title, count, onAdd, addLabel }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  onAdd?: () => void
  addLabel?: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3 mb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#2563EB]" />
        <h2 className="text-sm font-semibold text-[#0F172A]">{title}</h2>
        {count !== undefined && (
          <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-mono text-[#64748B] font-semibold">
            {count}
          </span>
        )}
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel ?? 'Add'}
        </button>
      )}
    </div>
  )
}

export function NewCasePage() {
  const navigate = useNavigate()
  const { mutateAsync, isPending } = useCreateCase()

  const [affectedSku, setAffectedSku] = useState('')
  const [failedSupplier, setFailedSupplier] = useState('')
  const [delayedUntil, setDelayedUntil] = useState('')
  const [budget, setBudget] = useState('')
  const [currency, setCurrency] = useState('INR')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Dynamic lists
  const [jobs, setJobs] = useState<Partial<JobRequirement>[]>([])
  const [inventory, setInventory] = useState<Partial<InventoryRecord>[]>([])
  const [offers, setOffers] = useState<Partial<SupplierOffer>[]>([])

  const addJob = () => setJobs(j => [...j, { job_id: '', sku: '', required_quantity: 0 }])
  const removeJob = (i: number) => setJobs(j => j.filter((_, idx) => idx !== i))
  const updateJob = (i: number, field: string, val: unknown) =>
    setJobs(j => j.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)))

  const addInventory = () =>
    setInventory(v => [
      ...v,
      { sku: '', location: null, available_quantity: 0, required_quantity: 0, shortage: 0, min_stock_level: null },
    ])
  const removeInventory = (i: number) => setInventory(v => v.filter((_, idx) => idx !== i))
  const updateInventory = (i: number, field: string, val: unknown) =>
    setInventory(v => v.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)))

  const addOffer = () => setOffers(o => [...o, { supplier_id: '', sku: '', unit_price: '0', currency }])
  const removeOffer = (i: number) => setOffers(o => o.filter((_, idx) => idx !== i))
  const updateOffer = (i: number, field: string, val: unknown) =>
    setOffers(o => o.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)))

  const isValid = affectedSku.trim() && failedSupplier.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || isPending || submitted) return
    setServerError(null)
    setSubmitted(true)

    try {
      const result = await mutateAsync({
        affected_sku: affectedSku.trim().toUpperCase(),
        failed_supplier_id: failedSupplier.trim(),
        delayed_until: delayedUntil || null,
        budget: budget || null,
        currency,
        jobs: jobs.filter(j => j.job_id && j.sku) as JobRequirement[],
        inventory: inventory.filter(i => i.sku) as InventoryRecord[],
        offers: offers.filter(o => o.supplier_id && o.sku) as SupplierOffer[],
      })
      navigate(`/disruptions/${result.case_id}`)
    } catch (err) {
      setSubmitted(false)
      if (err instanceof ApiClientError) {
        setServerError(typeof err.detail === 'string' ? err.detail : 'Validation failed — check your input.')
      } else {
        setServerError('An unexpected error occurred while creating the disruption case.')
      }
    }
  }

  const fieldClass = 'input-field'

  return (
    <div className="mx-auto max-w-3xl flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <Link
          to="/disruptions"
          className="inline-flex items-center gap-1.5 text-xs text-[#64748B] hover:text-[#2563EB] transition-colors font-medium"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Disruptions
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
              Disruption Incident Intake
            </h1>
            <p className="mt-1 text-xs text-[#475569]">
              Log a supplier failure or material delay to trigger automated multi-agent recovery analysis.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        {serverError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEE2E2] p-4 text-xs text-[#DC2626]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Core Parameters */}
        <div className="card p-5 flex flex-col gap-4 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <SectionHeader icon={Tag} title="Primary Disruption Parameters" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sku" className="text-xs font-semibold text-[#475569]">
                Affected Material SKU <span aria-hidden="true" className="text-[#DC2626]">*</span>
              </label>
              <input
                id="sku"
                required
                value={affectedSku}
                onChange={e => setAffectedSku(e.target.value)}
                placeholder="e.g. SKU-MOTOR-01"
                className={fieldClass}
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="supplier" className="text-xs font-semibold text-[#475569]">
                Failed Supplier ID <span aria-hidden="true" className="text-[#DC2626]">*</span>
              </label>
              <input
                id="supplier"
                required
                value={failedSupplier}
                onChange={e => setFailedSupplier(e.target.value)}
                placeholder="e.g. SUPP-APEX-09"
                className={fieldClass}
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="budget" className="text-xs font-semibold text-[#475569]">
                Recovery Budget Ceiling
              </label>
              <input
                id="budget"
                type="number"
                min="0"
                step="0.01"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                placeholder="0.00"
                className={fieldClass}
                disabled={isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="currency" className="text-xs font-semibold text-[#475569]">
                Currency
              </label>
              <select
                id="currency"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] px-3 py-2 text-xs text-[#0F172A] focus-visible:border-[#2563EB] focus-visible:outline-none focus:ring-2 focus:ring-[#2563EB]/20 shadow-2xs font-medium"
                disabled={isPending}
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="delayed" className="text-xs font-semibold text-[#475569]">
                Production Deadline / Delay Window
              </label>
              <input
                id="delayed"
                type="datetime-local"
                value={delayedUntil}
                onChange={e => setDelayedUntil(e.target.value)}
                className={fieldClass}
                disabled={isPending}
              />
            </div>
          </div>
        </div>

        {/* Job Requirements */}
        <div className="card p-5 flex flex-col gap-4 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <SectionHeader
            icon={Briefcase}
            title="Impacted Manufacturing Jobs"
            count={jobs.length}
            onAdd={addJob}
            addLabel="Add Job Schedule"
          />

          {jobs.length === 0 ? (
            <p className="text-xs text-[#64748B] py-2">
              No manufacturing jobs added. Click &quot;Add Job Schedule&quot; if this disruption halts specific assembly lines.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {jobs.map((job, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Job ID</label>
                    <input
                      value={job.job_id ?? ''}
                      onChange={e => updateJob(i, 'job_id', e.target.value)}
                      placeholder="JOB-101"
                      className="input-field mt-1 py-1 text-xs"
                      disabled={isPending}
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Required SKU</label>
                    <input
                      value={job.sku ?? ''}
                      onChange={e => updateJob(i, 'sku', e.target.value.toUpperCase())}
                      placeholder="SKU-XXX"
                      className="input-field mt-1 py-1 text-xs"
                      disabled={isPending}
                    />
                  </div>
                  <div className="w-24">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Quantity</label>
                    <input
                      type="number"
                      min="0"
                      value={job.required_quantity ?? 0}
                      onChange={e => updateJob(i, 'required_quantity', Number(e.target.value))}
                      className="input-field mt-1 py-1 text-xs tabular-nums text-right font-medium"
                      disabled={isPending}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeJob(i)}
                    className="self-end p-2 text-[#64748B] hover:text-[#DC2626] transition-colors"
                    aria-label="Remove job"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Local Warehouse Inventory */}
        <div className="card p-5 flex flex-col gap-4 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <SectionHeader
            icon={Layers}
            title="Warehouse Inventory Positions"
            count={inventory.length}
            onAdd={addInventory}
            addLabel="Add Stock Position"
          />

          {inventory.length === 0 ? (
            <p className="text-xs text-[#64748B] py-2">
              No local warehouse inventory specified. Add stock counts to calculate deficit metrics automatically.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {inventory.map((inv, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">SKU</label>
                    <input
                      value={inv.sku ?? ''}
                      onChange={e => updateInventory(i, 'sku', e.target.value.toUpperCase())}
                      placeholder="SKU-XXX"
                      className="input-field mt-1 py-1 text-xs"
                      disabled={isPending}
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Storage Location</label>
                    <input
                      value={inv.location ?? ''}
                      onChange={e => updateInventory(i, 'location', e.target.value)}
                      placeholder="Bay 1 / Rack A"
                      className="input-field mt-1 py-1 text-xs"
                      disabled={isPending}
                    />
                  </div>
                  <div className="w-20">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Avail</label>
                    <input
                      type="number"
                      min="0"
                      value={inv.available_quantity ?? 0}
                      onChange={e => updateInventory(i, 'available_quantity', Number(e.target.value))}
                      className="input-field mt-1 py-1 text-xs tabular-nums text-right font-medium"
                      disabled={isPending}
                    />
                  </div>
                  <div className="w-20">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Req</label>
                    <input
                      type="number"
                      min="0"
                      value={inv.required_quantity ?? 0}
                      onChange={e => updateInventory(i, 'required_quantity', Number(e.target.value))}
                      className="input-field mt-1 py-1 text-xs tabular-nums text-right font-medium"
                      disabled={isPending}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeInventory(i)}
                    className="self-end p-2 text-[#64748B] hover:text-[#DC2626] transition-colors"
                    aria-label="Remove inventory record"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Candidate Supplier Offers */}
        <div className="card p-5 flex flex-col gap-4 bg-[#FFFFFF] border-[#E2E8F0] shadow-sm">
          <SectionHeader
            icon={DollarSign}
            title="Candidate Supplier Quotes"
            count={offers.length}
            onAdd={addOffer}
            addLabel="Add Supplier Quote"
          />

          {offers.length === 0 ? (
            <p className="text-xs text-[#64748B] py-2">
              No preliminary quotes attached. The discovery specialist agent can automatically scan the network for substitute sources.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {offers.map((offer, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Supplier ID</label>
                    <input
                      value={offer.supplier_id ?? ''}
                      onChange={e => updateOffer(i, 'supplier_id', e.target.value)}
                      placeholder="SUPP-002"
                      className="input-field mt-1 py-1 text-xs"
                      disabled={isPending}
                    />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Sub SKU</label>
                    <input
                      value={offer.sku ?? ''}
                      onChange={e => updateOffer(i, 'sku', e.target.value.toUpperCase())}
                      placeholder="SKU-SUB"
                      className="input-field mt-1 py-1 text-xs"
                      disabled={isPending}
                    />
                  </div>
                  <div className="w-24">
                    <label className="text-[10px] uppercase text-[#64748B] font-semibold">Unit Price ({currency})</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={offer.unit_price ?? '0'}
                      onChange={e => updateOffer(i, 'unit_price', e.target.value)}
                      className="input-field mt-1 py-1 text-xs tabular-nums text-right font-medium"
                      disabled={isPending}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeOffer(i)}
                    className="self-end p-2 text-[#64748B] hover:text-[#DC2626] transition-colors"
                    aria-label="Remove offer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || isPending || submitted}
            className="btn-primary"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Ingesting Disruption…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Send className="h-4 w-4" />
                Initiate Disruption Intake
              </span>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
