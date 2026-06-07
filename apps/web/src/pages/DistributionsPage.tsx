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
  planned: 'Planifié',
  in_progress: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
}

const STATUS_COLORS: Record<AidStatus, string> = {
  planned: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

const AID_LABELS: Record<string, string> = {
  food: 'Vivres', medicine: 'Médicaments', shelter: 'Abri',
  school_kit: 'Kit scolaire', hygiene_kit: "Kit d'hygiène",
  cash_transfer: 'Aide financière', nfi: 'Articles NFI',
  water_sanitation: 'Eau/assainissement', protection: 'Protection', other: 'Autre',
}

const CreateSchema = z.object({
  aidType: z.string().min(1, 'Type requis'),
  description: z.string().max(500).default(''),
  quantity: z.coerce.number().positive('Quantité invalide'),
  unit: z.string().min(1, 'Unité requise'),
  targetPcodes: z.string().min(1, 'Zone requise'),
  plannedDate: z.string().min(1, 'Date requise'),
  organizationName: z.string().min(1, 'Organisation requise'),
  totalBeneficiariesTargeted: z.coerce.number().int().positive('Nombre requis'),
})

type CreateForm = z.infer<typeof CreateSchema>

const ScanReceiptSchema = z.object({
  qrCodeScanned: z.string().min(1, 'QR code requis'),
  quantity: z.coerce.number().positive().default(1),
  notes: z.string().optional(),
})

type ScanForm = z.infer<typeof ScanReceiptSchema>

export function DistributionsPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
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
  const scanForm = useForm<ScanForm>({
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
      const msg = e.response?.data?.error?.message ?? 'Erreur lors du scan'
      setScanResult({ success: false, message: msg })
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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Distributions d'aide</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-red-700 text-white rounded-lg text-sm font-medium hover:bg-red-800"
        >
          + Créer une distribution
        </button>
      </div>

      {/* Filtres */}
      <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500">
        <option value="">Tous statuts</option>
        {Object.entries(STATUS_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Organisation</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Zones cibles</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Statut</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Date prévue</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Progression</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Chargement...</td></tr>
            )}
            {!isLoading && distributions.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Aucune distribution</td></tr>
            )}
            {distributions.map(d => {
              const pct = d.totalBeneficiariesTargeted > 0
                ? Math.round(d.totalBeneficiariesServed / d.totalBeneficiariesTargeted * 100)
                : 0
              return (
                <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {AID_LABELS[d.aidType] ?? d.aidType}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{d.organizationName}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {d.targetPcodes?.slice(0, 3).join(', ')}
                    {d.targetPcodes?.length > 3 ? ` +${d.targetPcodes.length - 3}` : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[d.status]}`}>
                      {STATUS_LABELS[d.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {new Date(d.plannedDate).toLocaleDateString('fr-FR')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-red-600'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-gray-600 w-12 text-right">
                        {d.totalBeneficiariesServed}/{d.totalBeneficiariesTargeted}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setSelectedDist(d); setScanResult(null) }}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Détails
                      </button>
                      {d.status === 'in_progress' && (
                        <button
                          onClick={() => { setSelectedDist(d); setShowScan(true); setScanResult(null) }}
                          className="text-xs bg-red-700 text-white px-2 py-1 rounded hover:bg-red-800"
                        >
                          Scanner QR
                        </button>
                      )}
                      {d.status === 'planned' && (
                        <button
                          onClick={() => updateStatusMutation.mutate({ id: d.id, status: 'in_progress' })}
                          className="text-xs text-green-600 hover:text-green-800"
                        >
                          Démarrer
                        </button>
                      )}
                      <a
                        href={`/api/distributions/${d.id}/export.csv`}
                        className="text-xs text-gray-500 hover:text-gray-700"
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
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-gray-500">{pagination.total} distributions</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 border rounded-lg disabled:opacity-40">Précédent</button>
              <span className="px-3 py-1.5 text-gray-600">{page} / {pagination.pages}</span>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages}
                className="px-3 py-1.5 border rounded-lg disabled:opacity-40">Suivant</button>
            </div>
          </div>
        )}
      </div>

      {/* Panel détails + reçus */}
      {selectedDist && !showScan && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">
              Reçus — {AID_LABELS[selectedDist.aidType]} ({selectedDist.organizationName})
            </h2>
            <div className="flex gap-2">
              {selectedDist.status === 'in_progress' && (
                <button
                  onClick={() => { setShowScan(true); setScanResult(null) }}
                  className="px-3 py-1.5 bg-red-700 text-white text-sm rounded-lg hover:bg-red-800"
                >
                  Scanner un QR code
                </button>
              )}
              <button onClick={() => setSelectedDist(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">N° enreg.</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Zone</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Ménage</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Remis le</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">Aucun reçu encore enregistré</td></tr>
              )}
              {receipts.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs">{r.registrationNumber}</td>
                  <td className="px-3 py-2 text-gray-600">{r.locationPcode}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.householdSize}</td>
                  <td className="px-3 py-2 text-gray-600">{new Date(r.receivedAt).toLocaleString('fr-FR')}</td>
                  <td className="px-3 py-2 text-gray-600">{r.distributedByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel scan QR */}
      {selectedDist && showScan && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Scanner QR bénéficiaire</h3>
              <button onClick={() => { setShowScan(false); setScanResult(null) }}
                className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Distribution : <strong>{AID_LABELS[selectedDist.aidType]}</strong> — {selectedDist.organizationName}
            </p>

            {scanResult && (
              <div className={`p-3 rounded-xl mb-4 text-sm ${scanResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {scanResult.success ? '✓ ' : '✗ '}{scanResult.message}
              </div>
            )}

            <form onSubmit={scanForm.handleSubmit(d => scanMutation.mutate(d))} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Données QR scannées *
                </label>
                <textarea
                  {...scanForm.register('qrCodeScanned')}
                  rows={3}
                  placeholder='{"type":"SINAUR_BENEFICIARY","id":"...","regNum":"BEN-..."}'
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-red-500"
                />
                {scanForm.formState.errors.qrCodeScanned && (
                  <p className="text-red-600 text-xs mt-1">{scanForm.formState.errors.qrCodeScanned.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantité distribuée</label>
                <input
                  type="number" step="0.1" min="0.1"
                  {...scanForm.register('quantity')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optionnel)</label>
                <input
                  {...scanForm.register('notes')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={scanMutation.isPending}
                className="w-full px-4 py-3 bg-red-700 text-white rounded-xl font-semibold hover:bg-red-800 disabled:opacity-50"
              >
                {scanMutation.isPending ? 'Enregistrement...' : 'Confirmer la distribution'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal création */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Nouvelle distribution</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <form onSubmit={createForm.handleSubmit(d => createMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type d'aide *</label>
                  <select {...createForm.register('aidType')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">— Choisir —</option>
                    {Object.entries(AID_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  {createForm.formState.errors.aidType && (
                    <p className="text-red-600 text-xs mt-1">{createForm.formState.errors.aidType.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organisation *</label>
                  <input {...createForm.register('organizationName')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantité *</label>
                  <input type="number" {...createForm.register('quantity')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unité *</label>
                  <input {...createForm.register('unit')} placeholder="kg / cartons / personnes..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zones cibles (P-codes) *</label>
                  <input {...createForm.register('targetPcodes')} placeholder="CD01, CD02, ..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date prévue *</label>
                  <input type="datetime-local" {...createForm.register('plannedDate')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nb bénéficiaires cibles *</label>
                  <input type="number" {...createForm.register('totalBeneficiariesTargeted')}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea {...createForm.register('description')} rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              {createMutation.isError && (
                <p className="text-red-600 text-sm">
                  {(createMutation.error as any)?.response?.data?.error?.message ?? 'Erreur de création'}
                </p>
              )}

              <div className="flex gap-3">
                <button type="submit" disabled={createMutation.isPending}
                  className="flex-1 px-4 py-2 bg-red-700 text-white rounded-lg font-medium hover:bg-red-800 disabled:opacity-50">
                  {createMutation.isPending ? 'Création...' : 'Créer la distribution'}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
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
