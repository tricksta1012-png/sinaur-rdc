import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../lib/api.js'

type AidStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'

interface Distribution {
  id: string
  aidType: string
  description: string
  quantity: number
  unit: string
  status: AidStatus
  targetPcodes: string[]
  plannedDate: string
  organizationName: string
  totalBeneficiariesTargeted: number
  totalBeneficiariesServed: number
  responsibleAgentName?: string
}

const STATUS_LABELS: Record<AidStatus, string> = {
  planned:     'Planifié',
  in_progress: 'En cours',
  completed:   'Terminé',
  cancelled:   'Annulé',
}

const STATUS_BADGE: Record<AidStatus, string> = {
  planned:     'sn-pill-blue',
  in_progress: 'sn-pill-yellow',
  completed:   'sn-pill-green',
  cancelled:   'sn-pill-gray',
}

const AID_LABELS: Record<string, string> = {
  food: 'Vivres', medicine: 'Médicaments', shelter: 'Abri',
  school_kit: 'Kit scolaire', hygiene_kit: "Kit d'hygiène",
  cash_transfer: 'Aide financière', nfi: 'Articles NFI',
  water_sanitation: 'Eau/assainissement', protection: 'Protection', other: 'Autre',
}

const CreateSchema = z.object({
  aidType:                     z.string().min(1, 'Type requis'),
  description:                 z.string().max(500).default(''),
  quantity:                    z.coerce.number().positive('Quantité invalide'),
  unit:                        z.string().min(1, 'Unité requise'),
  targetPcodes:                z.string().min(1, 'Zone requise'),
  plannedDate:                 z.string().min(1, 'Date requise'),
  organizationName:            z.string().min(1, 'Organisation requise'),
  totalBeneficiariesTargeted:  z.coerce.number().int().positive('Nombre requis'),
})

type CreateForm = z.infer<typeof CreateSchema>

const ScanReceiptSchema = z.object({
  qrCodeScanned: z.string().min(1, 'QR code requis'),
  quantity:      z.coerce.number().positive().default(1),
  notes:         z.string().optional(),
})

type ScanForm = z.infer<typeof ScanReceiptSchema>

export function DistributionsPage() {
  const queryClient = useQueryClient()
  const [page, setPage]         = useState(1)
  const [status, setStatus]     = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedDist, setSelectedDist] = useState<Distribution | null>(null)
  const [showScan, setShowScan] = useState(false)
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['distributions', { status, page }],
    queryFn: () => apiClient.get('/distributions', {
      params: { status: status || undefined, page, limit: 20 },
    }).then(r => r.data),
    placeholderData: (prev) => prev,
  })

  const { data: receiptsData } = useQuery({
    queryKey: ['receipts', selectedDist?.id],
    queryFn: () => selectedDist
      ? apiClient.get(`/distributions/${selectedDist.id}/receipts`, { params: { limit: 50 } }).then(r => r.data)
      : Promise.resolve(null),
    enabled: !!selectedDist,
  })

  const createForm = useForm<CreateForm>({ resolver: zodResolver(CreateSchema) })
  const scanForm   = useForm<ScanForm>({
    resolver: zodResolver(ScanReceiptSchema),
    defaultValues: { quantity: 1 },
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) => apiClient.post('/distributions', {
      ...data,
      targetPcodes: data.targetPcodes.split(',').map(s => s.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributions'] })
      setShowCreate(false)
      createForm.reset()
    },
  })

  const scanMutation = useMutation({
    mutationFn: (data: ScanForm) =>
      apiClient.post(`/distributions/${selectedDist!.id}/receipts`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributions'] })
      queryClient.invalidateQueries({ queryKey: ['receipts', selectedDist?.id] })
      setScanResult({ success: true, message: 'Aide enregistrée avec succès.' })
      scanForm.reset({ quantity: 1 })
    },
    onError: (e: any) => {
      setScanResult({ success: false, message: e.response?.data?.error?.message ?? 'Erreur lors du scan' })
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/distributions/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['distributions'] }),
  })

  const distributions: Distribution[] = data?.data ?? []
  const pagination = data?.pagination
  const receipts = receiptsData?.data ?? []

  return (
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Distributions d'aide</h1>
          <p className="sn-page-subtitle">Planification et suivi des distributions humanitaires</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="sn-btn-primary">
          + Créer une distribution
        </button>
      </div>

      {/* Filtre statut */}
      <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="sn-select w-auto">
        <option value="">Tous statuts</option>
        {Object.entries(STATUS_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>

      {/* Table */}
      <div className="sn-table-wrap">
        <table className="sn-table">
          <thead>
            <tr>
              <th>Type d'aide</th>
              <th>Organisation</th>
              <th>Zones cibles</th>
              <th>Statut</th>
              <th>Date prévue</th>
              <th className="text-right">Progression</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="sn-empty">Chargement…</td></tr>
            )}
            {!isLoading && distributions.length === 0 && (
              <tr><td colSpan={7} className="sn-empty">Aucune distribution</td></tr>
            )}
            {distributions.map(d => {
              const pct = d.totalBeneficiariesTargeted > 0
                ? Math.round(d.totalBeneficiariesServed / d.totalBeneficiariesTargeted * 100)
                : 0
              return (
                <tr key={d.id}>
                  <td className="font-medium text-gray-900">{AID_LABELS[d.aidType] ?? d.aidType}</td>
                  <td>{d.organizationName}</td>
                  <td className="text-xs text-gray-500">
                    {d.targetPcodes?.slice(0, 3).join(', ')}
                    {d.targetPcodes?.length > 3 ? ` +${d.targetPcodes.length - 3}` : ''}
                  </td>
                  <td>
                    <span className={STATUS_BADGE[d.status]}>{STATUS_LABELS[d.status]}</span>
                  </td>
                  <td className="whitespace-nowrap text-gray-600">
                    {new Date(d.plannedDate).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-sinaur-600'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-500 w-14 text-right">
                        {d.totalBeneficiariesServed}/{d.totalBeneficiariesTargeted}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setSelectedDist(d); setScanResult(null) }}
                        className="sn-btn-link-blue"
                      >
                        Détails
                      </button>
                      {d.status === 'in_progress' && (
                        <button
                          onClick={() => { setSelectedDist(d); setShowScan(true); setScanResult(null) }}
                          className="sn-btn-primary-sm"
                        >
                          Scanner QR
                        </button>
                      )}
                      {d.status === 'planned' && (
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: d.id, status: 'in_progress' })}
                          className="sn-btn-link-green"
                        >
                          Démarrer
                        </button>
                      )}
                      <a
                        href={`/api/distributions/${d.id}/export.csv`}
                        className="sn-btn-link-gray"
                        download
                      >
                        CSV
                      </a>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">{pagination.total} distributions</span>
            <div className="sn-pagination">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="sn-page-btn">Précédent</button>
              <span className="text-sm text-gray-600 px-2">{page} / {pagination.pages}</span>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="sn-page-btn">Suivant</button>
            </div>
          </div>
        )}
      </div>

      {/* Panel détails + reçus */}
      {selectedDist && !showScan && (
        <div className="sn-card sn-card-body">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">
              Reçus — {AID_LABELS[selectedDist.aidType]} ({selectedDist.organizationName})
            </h2>
            <div className="flex items-center gap-2">
              {selectedDist.status === 'in_progress' && (
                <button
                  onClick={() => { setShowScan(true); setScanResult(null) }}
                  className="sn-btn-primary-sm"
                >
                  Scanner un QR code
                </button>
              )}
              <button onClick={() => setSelectedDist(null)} className="sn-modal-close">✕</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="sn-table">
              <thead>
                <tr>
                  <th>N° enreg.</th>
                  <th>Zone</th>
                  <th className="text-right">Ménage</th>
                  <th>Remis le</th>
                  <th>Agent</th>
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 && (
                  <tr><td colSpan={5} className="sn-empty">Aucun reçu encore enregistré</td></tr>
                )}
                {receipts.map((r: any) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">{r.registrationNumber}</td>
                    <td>{r.locationPcode}</td>
                    <td className="text-right tabular-nums">{r.householdSize}</td>
                    <td className="text-xs whitespace-nowrap">{new Date(r.receivedAt).toLocaleString('fr-FR')}</td>
                    <td className="text-xs">{r.distributedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal — Scanner QR */}
      {selectedDist && showScan && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Scanner QR bénéficiaire</h3>
              <button className="sn-modal-close" onClick={() => { setShowScan(false); setScanResult(null) }}>✕</button>
            </div>
            <p className="text-sm text-gray-500 -mt-2">
              Distribution : <strong>{AID_LABELS[selectedDist.aidType]}</strong> — {selectedDist.organizationName}
            </p>

            {scanResult && (
              <div className={scanResult.success ? 'sn-alert-success' : 'sn-alert-danger'}>
                {scanResult.success ? '✓ ' : '✗ '}{scanResult.message}
              </div>
            )}

            <form onSubmit={scanForm.handleSubmit(d => scanMutation.mutate(d))} className="space-y-4">
              <div>
                <label className="sn-label">Données QR scannées *</label>
                <textarea
                  {...scanForm.register('qrCodeScanned')}
                  rows={3}
                  placeholder='{"type":"SINAUR_BENEFICIARY","id":"...","regNum":"BEN-..."}'
                  className="sn-textarea font-mono"
                />
                {scanForm.formState.errors.qrCodeScanned && (
                  <p className="sn-field-error">{scanForm.formState.errors.qrCodeScanned.message}</p>
                )}
              </div>
              <div>
                <label className="sn-label">Quantité distribuée</label>
                <input type="number" step="0.1" min="0.1" {...scanForm.register('quantity')} className="sn-input" />
              </div>
              <div>
                <label className="sn-label">Notes (optionnel)</label>
                <input {...scanForm.register('notes')} className="sn-input" />
              </div>
              <button type="submit" disabled={scanMutation.isPending} className="sn-btn-primary w-full py-3">
                {scanMutation.isPending ? 'Enregistrement…' : 'Confirmer la distribution'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Créer distribution */}
      {showCreate && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal-lg">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Nouvelle distribution</h3>
              <button className="sn-modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>

            <form onSubmit={createForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="sn-label">Type d'aide *</label>
                  <select {...createForm.register('aidType')} className="sn-select">
                    <option value="">— Choisir —</option>
                    {Object.entries(AID_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  {createForm.formState.errors.aidType && (
                    <p className="sn-field-error">{createForm.formState.errors.aidType.message}</p>
                  )}
                </div>
                <div>
                  <label className="sn-label">Organisation *</label>
                  <input {...createForm.register('organizationName')} className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Quantité *</label>
                  <input type="number" {...createForm.register('quantity')} className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Unité *</label>
                  <input {...createForm.register('unit')} placeholder="kg / cartons / personnes…" className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Zones cibles (P-codes) *</label>
                  <input {...createForm.register('targetPcodes')} placeholder="CD01, CD02, …" className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Date prévue *</label>
                  <input type="datetime-local" {...createForm.register('plannedDate')} className="sn-input" />
                </div>
                <div className="col-span-2">
                  <label className="sn-label">Nb bénéficiaires cibles *</label>
                  <input type="number" {...createForm.register('totalBeneficiariesTargeted')} className="sn-input" />
                </div>
                <div className="col-span-2">
                  <label className="sn-label">Description</label>
                  <textarea {...createForm.register('description')} rows={2} className="sn-textarea" />
                </div>
              </div>

              {createMutation.isError && (
                <p className="sn-field-error text-sm">
                  {(createMutation.error as any)?.response?.data?.error?.message ?? 'Erreur de création'}
                </p>
              )}

              <div className="sn-modal-actions">
                <button type="submit" disabled={createMutation.isPending} className="sn-btn-primary flex-1">
                  {createMutation.isPending ? 'Création…' : 'Créer la distribution'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)} className="sn-btn-secondary">
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
