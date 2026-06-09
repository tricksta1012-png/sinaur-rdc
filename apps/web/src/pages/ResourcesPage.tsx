import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../lib/api.js'
import { useAuthStore } from '../stores/auth.js'

type ResourceType = 'food' | 'water' | 'medicine' | 'shelter_kit' | 'nfi' | 'hygiene_kit' | 'fuel' | 'equipment' | 'other'
type MovementType = 'in' | 'out' | 'transfer' | 'adjustment'
type DemandStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled'
type DemandUrgency = 'low' | 'normal' | 'high' | 'critical'

interface Stock {
  id: string
  resourceType: ResourceType
  resourceName: string
  unit: string
  quantityAvailable: number
  quantityReserved: number
  minimumThreshold: number
  updatedAt: string
}

interface Depot {
  id: string
  name: string
  pcode: string
  address?: string
  managerName?: string
  isActive: boolean
  stockLines: number
  totalUnits: number
  lowStockCount: number
  stocks?: Stock[]
}

interface LowAlert {
  stockId: string
  resourceName: string
  unit: string
  quantityAvailable: number
  minimumThreshold: number
  gap: number
  depotId: string
  depotName: string
  pcode: string
}

interface Demand {
  id: string
  crisisId: string
  crisisGlide: string
  crisisTitle: string
  depotId: string | null
  depotName: string | null
  stockId: string | null
  resourceType: ResourceType
  resourceName: string
  unit: string
  quantityNeeded: string
  quantityAllocated: string | null
  urgency: DemandUrgency
  status: DemandStatus
  notes: string | null
  requestedByName: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  createdAt: string
}

interface Crisis {
  id: string
  glideNumber: string
  title: string
  status: string
}

const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: 'Vivres', water: 'Eau', medicine: 'Médicaments',
  shelter_kit: 'Kit abri', nfi: 'Articles NFI', hygiene_kit: "Kit hygiène",
  fuel: 'Carburant', equipment: 'Équipement', other: 'Autre',
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: 'Entrée', out: 'Sortie', transfer: 'Transfert', adjustment: 'Ajustement',
}

const URGENCY_BADGE: Record<DemandUrgency, string> = {
  critical: 'sn-badge-dark',
  high:     'sn-badge-red',
  normal:   'sn-badge-blue',
  low:      'sn-badge-gray',
}

const URGENCY_LABELS: Record<DemandUrgency, string> = {
  critical: 'Critique', high: 'Haute', normal: 'Normale', low: 'Faible',
}

const STATUS_BADGE: Record<DemandStatus, string> = {
  pending:   'sn-badge-yellow',
  approved:  'sn-badge-green',
  rejected:  'sn-badge-red',
  fulfilled: 'sn-badge-gray',
}

const STATUS_LABELS: Record<DemandStatus, string> = {
  pending: 'En attente', approved: 'Approuvée', rejected: 'Rejetée', fulfilled: 'Réalisée',
}

const DepotSchema = z.object({
  name:    z.string().min(2, 'Nom requis'),
  pcode:   z.string().min(2, 'P-code requis'),
  address: z.string().optional(),
})

const StockSchema = z.object({
  resourceType:      z.string().min(1, 'Type requis'),
  resourceName:      z.string().min(2, 'Nom requis'),
  unit:              z.string().min(1, 'Unité requise'),
  quantityAvailable: z.coerce.number().min(0),
  minimumThreshold:  z.coerce.number().min(0).default(0),
})

const MovementSchema = z.object({
  stockId:      z.string().uuid('Sélectionnez un article'),
  movementType: z.string().min(1),
  quantity:     z.coerce.number().positive('Quantité invalide'),
  reason:       z.string().optional(),
})

const DemandSchema = z.object({
  crisisId:      z.string().uuid('Sélectionnez une crise'),
  resourceType:  z.string().min(1, 'Type requis'),
  resourceName:  z.string().min(2, 'Nom requis'),
  unit:          z.string().min(1, 'Unité requise'),
  quantityNeeded:z.coerce.number().positive('Quantité invalide'),
  urgency:       z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  notes:         z.string().optional(),
})

type DepotForm    = z.infer<typeof DepotSchema>
type StockForm    = z.infer<typeof StockSchema>
type MovementForm = z.infer<typeof MovementSchema>
type DemandForm   = z.infer<typeof DemandSchema>

export function ResourcesPage() {
  const qc = useQueryClient()
  const userRole = useAuthStore(s => s.user?.role)
  const canApprove = userRole === 'system_admin' || userRole === 'national_decision_maker'

  const [tab, setTab]                       = useState<'depots' | 'demands'>('depots')
  const [selectedDepot, setSelectedDepot]   = useState<Depot | null>(null)
  const [showDepotForm, setShowDepotForm]   = useState(false)
  const [showStockForm, setShowStockForm]   = useState(false)
  const [showMovementForm, setShowMovementForm] = useState(false)
  const [showDemandForm, setShowDemandForm] = useState(false)
  const [demandStatusFilter, setDemandStatusFilter] = useState<string>('')
  const [rejectId, setRejectId]             = useState<string | null>(null)
  const [rejectNotes, setRejectNotes]       = useState('')

  const { data: depotsData, isLoading } = useQuery({
    queryKey: ['resource-depots'],
    queryFn: () => apiClient.get<{ success: boolean; data: Depot[] }>('/resources/depots').then(r => r.data.data),
  })

  const { data: alertsData } = useQuery({
    queryKey: ['resource-alerts'],
    queryFn: () => apiClient.get<{ success: boolean; data: LowAlert[] }>('/resources/alerts').then(r => r.data.data),
  })

  const { data: depotDetail } = useQuery({
    queryKey: ['resource-depot', selectedDepot?.id],
    queryFn: () => apiClient.get<{ success: boolean; data: Depot }>(`/resources/depots/${selectedDepot!.id}`).then(r => r.data.data),
    enabled: !!selectedDepot,
  })

  const { data: demandsData, isLoading: demandsLoading } = useQuery({
    queryKey: ['resource-demands', demandStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (demandStatusFilter) params.set('status', demandStatusFilter)
      return apiClient.get<{ success: boolean; data: Demand[] }>(`/resources/demands?${params}`).then(r => r.data.data)
    },
    enabled: tab === 'demands',
  })

  const { data: crisesData } = useQuery({
    queryKey: ['crises-active'],
    queryFn: () => apiClient.get<{ success: boolean; data: Crisis[] }>('/crises?status=active&limit=100').then(r => r.data.data),
    enabled: showDemandForm,
  })

  const depotForm    = useForm<DepotForm>({ resolver: zodResolver(DepotSchema) })
  const stockForm    = useForm<StockForm>({ resolver: zodResolver(StockSchema) })
  const movementForm = useForm<MovementForm>({ resolver: zodResolver(MovementSchema) })
  const demandForm   = useForm<DemandForm>({ resolver: zodResolver(DemandSchema) })

  const createDepot = useMutation({
    mutationFn: (data: DepotForm) => apiClient.post('/resources/depots', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-depots'] }); setShowDepotForm(false); depotForm.reset() },
  })

  const createStock = useMutation({
    mutationFn: (data: StockForm) => apiClient.post(`/resources/depots/${selectedDepot!.id}/stocks`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-depot', selectedDepot?.id] })
      qc.invalidateQueries({ queryKey: ['resource-depots'] })
      setShowStockForm(false); stockForm.reset()
    },
  })

  const createMovement = useMutation({
    mutationFn: (data: MovementForm) => apiClient.post(`/resources/depots/${selectedDepot!.id}/movements`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-depot', selectedDepot?.id] })
      qc.invalidateQueries({ queryKey: ['resource-depots'] })
      qc.invalidateQueries({ queryKey: ['resource-alerts'] })
      setShowMovementForm(false); movementForm.reset()
    },
  })

  const createDemand = useMutation({
    mutationFn: (data: DemandForm) => apiClient.post('/resources/demands', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-demands'] })
      setShowDemandForm(false); demandForm.reset()
    },
  })

  const approveDemand = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/resources/demands/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-demands'] }),
  })

  const rejectDemand = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiClient.patch(`/resources/demands/${id}/reject`, { notes: notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-demands'] }); setRejectId(null); setRejectNotes('') },
  })

  const fulfillDemand = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/resources/demands/${id}/fulfill`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-demands'] }),
  })

  const depots  = depotsData ?? []
  const alerts  = alertsData ?? []
  const demands = demandsData ?? []
  const stocks  = depotDetail?.stocks ?? selectedDepot?.stocks ?? []

  return (
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Ressources & Stocks</h1>
          <p className="sn-page-subtitle">Gestion des dépôts, stocks humanitaires et demandes d'affectation</p>
        </div>
        <div className="flex gap-2">
          {tab === 'demands' ? (
            <button onClick={() => setShowDemandForm(true)} className="sn-btn-primary">
              + Nouvelle demande
            </button>
          ) : (
            <button onClick={() => setShowDepotForm(true)} className="sn-btn-primary">
              + Nouveau dépôt
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        <button
          onClick={() => setTab('depots')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'depots' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Dépôts & Stocks
        </button>
        <button
          onClick={() => setTab('demands')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            tab === 'demands' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Demandes
        </button>
      </div>

      {/* ── Tab Dépôts ── */}
      {tab === 'depots' && (
        <>
          {alerts.length > 0 && (
            <div className="sn-alert-danger">
              <h3 className="font-semibold mb-2">Stocks sous le seuil minimum ({alerts.length})</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {alerts.map(a => (
                  <div key={a.stockId} className="bg-white rounded-lg p-3 border border-red-100">
                    <div className="font-medium text-gray-900 text-xs">{a.resourceName}</div>
                    <div className="text-gray-500 text-xs">{a.depotName} · {a.pcode}</div>
                    <div className="mt-1 text-xs">
                      <span className="text-red-600 font-semibold">{a.quantityAvailable} {a.unit}</span>
                      <span className="text-gray-400"> / seuil {a.minimumThreshold}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <p className="sn-section-label">Dépôts ({depots.length})</p>
              {isLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="sn-skeleton h-20 rounded-xl" />)}
                </div>
              ) : depots.length === 0 ? (
                <div className="sn-empty">Aucun dépôt enregistré</div>
              ) : (
                depots.map(depot => (
                  <button
                    key={depot.id}
                    onClick={() => setSelectedDepot(depot)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedDepot?.id === depot.id
                        ? 'border-sinaur-600 bg-sinaur-50 ring-1 ring-sinaur-200'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-gray-900 text-sm">{depot.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{depot.pcode}</div>
                      </div>
                      <span className={depot.isActive ? 'sn-pill-green' : 'sn-pill-gray'}>
                        {depot.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-3 text-xs text-gray-500">
                      <span>{depot.stockLines} articles</span>
                      {depot.lowStockCount > 0 && (
                        <span className="text-red-600 font-medium">{depot.lowStockCount} stock(s) bas</span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="lg:col-span-2">
              {!selectedDepot ? (
                <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-gray-200 bg-white">
                  <span className="text-3xl mb-3">🏭</span>
                  <p className="text-gray-400 text-sm">Sélectionnez un dépôt pour voir ses stocks</p>
                </div>
              ) : (
                <div className="sn-card">
                  <div className="sn-card-header">
                    <div>
                      <h2 className="font-semibold text-gray-900">{depotDetail?.name ?? selectedDepot.name}</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {depotDetail?.pcode ?? selectedDepot.pcode}
                        {depotDetail?.address ? ` · ${depotDetail.address}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setShowMovementForm(true)} className="sn-btn-secondary-sm">
                        + Mouvement
                      </button>
                      <button onClick={() => setShowStockForm(true)} className="sn-btn-primary-sm">
                        + Article
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {stocks.length === 0 ? (
                      <div className="sn-empty">Aucun article en stock</div>
                    ) : (
                      <table className="sn-table">
                        <thead>
                          <tr>
                            <th>Article</th>
                            <th>Type</th>
                            <th className="text-right">Disponible</th>
                            <th className="text-right">Réservé</th>
                            <th className="text-right">Seuil</th>
                            <th className="text-center">État</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stocks.map(s => {
                            const isLow = s.minimumThreshold > 0 && s.quantityAvailable <= s.minimumThreshold
                            return (
                              <tr key={s.id}>
                                <td className="font-medium text-gray-900">{s.resourceName}</td>
                                <td className="text-xs text-gray-500">{RESOURCE_LABELS[s.resourceType] ?? s.resourceType}</td>
                                <td className="text-right font-medium">{s.quantityAvailable.toLocaleString('fr-FR')} <span className="text-xs text-gray-400">{s.unit}</span></td>
                                <td className="text-right text-gray-500">{s.quantityReserved.toLocaleString('fr-FR')}</td>
                                <td className="text-right text-gray-500">{s.minimumThreshold > 0 ? s.minimumThreshold.toLocaleString('fr-FR') : '—'}</td>
                                <td className="text-center">
                                  {isLow ? <span className="sn-badge-red">Bas</span> : <span className="sn-badge-green">OK</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Tab Demandes ── */}
      {tab === 'demands' && (
        <>
          <div className="flex gap-2 flex-wrap">
            {(['', 'pending', 'approved', 'rejected', 'fulfilled'] as const).map(s => (
              <button
                key={s}
                onClick={() => setDemandStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  demandStatusFilter === s
                    ? 'bg-sinaur-700 text-white border-sinaur-700'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {s === '' ? 'Toutes' : STATUS_LABELS[s as DemandStatus]}
              </button>
            ))}
          </div>

          <div className="sn-table-wrap">
            {demandsLoading ? (
              <div className="sn-empty">Chargement…</div>
            ) : demands.length === 0 ? (
              <div className="sn-empty">Aucune demande trouvée</div>
            ) : (
              <table className="sn-table">
                <thead>
                  <tr>
                    <th>Crise</th>
                    <th>Ressource demandée</th>
                    <th className="text-right">Quantité</th>
                    <th>Urgence</th>
                    <th>Statut</th>
                    <th>Demandeur</th>
                    <th>Date</th>
                    {canApprove && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {demands.map(d => (
                    <tr key={d.id}>
                      <td>
                        <div className="font-mono text-xs text-gray-500">{d.crisisGlide}</div>
                        <div className="text-xs text-gray-700 font-medium max-w-[160px] truncate">{d.crisisTitle}</div>
                      </td>
                      <td>
                        <div className="font-medium text-gray-900 text-xs">{d.resourceName}</div>
                        <div className="text-xs text-gray-400">{RESOURCE_LABELS[d.resourceType] ?? d.resourceType}</div>
                      </td>
                      <td className="text-right text-sm font-medium">
                        {Number(d.quantityNeeded).toLocaleString('fr-FR')}
                        {d.quantityAllocated && (
                          <div className="text-xs text-green-600">
                            ✓ {Number(d.quantityAllocated).toLocaleString('fr-FR')} alloués
                          </div>
                        )}
                        <span className="text-xs text-gray-400"> {d.unit}</span>
                      </td>
                      <td>
                        <span className={URGENCY_BADGE[d.urgency]}>
                          {URGENCY_LABELS[d.urgency]}
                        </span>
                      </td>
                      <td>
                        <span className={STATUS_BADGE[d.status]}>{STATUS_LABELS[d.status]}</span>
                        {d.depotName && <div className="text-xs text-gray-400 mt-0.5">{d.depotName}</div>}
                      </td>
                      <td className="text-xs text-gray-500">{d.requestedByName ?? '—'}</td>
                      <td className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(d.createdAt).toLocaleDateString('fr-FR')}
                      </td>
                      {canApprove && (
                        <td className="text-right">
                          <div className="flex gap-1.5 justify-end">
                            {d.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => approveDemand.mutate(d.id)}
                                  disabled={approveDemand.isPending}
                                  className="sn-btn-link-green"
                                >
                                  Approuver
                                </button>
                                <button
                                  onClick={() => { setRejectId(d.id); setRejectNotes('') }}
                                  className="sn-btn-link-danger"
                                >
                                  Rejeter
                                </button>
                              </>
                            )}
                            {d.status === 'approved' && (
                              <button
                                onClick={() => fulfillDemand.mutate(d.id)}
                                disabled={fulfillDemand.isPending}
                                className="sn-btn-link-blue"
                              >
                                Marquer réalisée
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Modal — Nouveau dépôt */}
      {showDepotForm && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Nouveau dépôt</h3>
              <button className="sn-modal-close" onClick={() => setShowDepotForm(false)}>✕</button>
            </div>
            <form onSubmit={depotForm.handleSubmit(d => createDepot.mutate(d))} className="space-y-4">
              <div>
                <label className="sn-label">Nom du dépôt</label>
                <input {...depotForm.register('name')} className="sn-input" />
                {depotForm.formState.errors.name && <p className="sn-field-error">{depotForm.formState.errors.name.message}</p>}
              </div>
              <div>
                <label className="sn-label">P-code province</label>
                <input {...depotForm.register('pcode')} placeholder="ex: CD-KN" className="sn-input" />
                {depotForm.formState.errors.pcode && <p className="sn-field-error">{depotForm.formState.errors.pcode.message}</p>}
              </div>
              <div>
                <label className="sn-label">Adresse (optionnel)</label>
                <input {...depotForm.register('address')} className="sn-input" />
              </div>
              <div className="sn-modal-actions">
                <button type="button" onClick={() => setShowDepotForm(false)} className="sn-btn-secondary flex-1">Annuler</button>
                <button type="submit" disabled={createDepot.isPending} className="sn-btn-primary flex-1">
                  {createDepot.isPending ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Nouvel article */}
      {showStockForm && selectedDepot && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Ajouter un article — {selectedDepot.name}</h3>
              <button className="sn-modal-close" onClick={() => setShowStockForm(false)}>✕</button>
            </div>
            <form onSubmit={stockForm.handleSubmit(d => createStock.mutate(d))} className="space-y-4">
              <div>
                <label className="sn-label">Type</label>
                <select {...stockForm.register('resourceType')} className="sn-select">
                  <option value="">-- Sélectionner --</option>
                  {Object.entries(RESOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {stockForm.formState.errors.resourceType && <p className="sn-field-error">{stockForm.formState.errors.resourceType.message}</p>}
              </div>
              <div>
                <label className="sn-label">Nom de l'article</label>
                <input {...stockForm.register('resourceName')} placeholder="ex: Riz 25kg, Savon" className="sn-input" />
                {stockForm.formState.errors.resourceName && <p className="sn-field-error">{stockForm.formState.errors.resourceName.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sn-label">Unité</label>
                  <input {...stockForm.register('unit')} placeholder="sac, litre, boîte" className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Quantité initiale</label>
                  <input type="number" {...stockForm.register('quantityAvailable')} className="sn-input" />
                </div>
              </div>
              <div>
                <label className="sn-label">Seuil minimum d'alerte</label>
                <input type="number" {...stockForm.register('minimumThreshold')} className="sn-input" />
              </div>
              <div className="sn-modal-actions">
                <button type="button" onClick={() => setShowStockForm(false)} className="sn-btn-secondary flex-1">Annuler</button>
                <button type="submit" disabled={createStock.isPending} className="sn-btn-primary flex-1">
                  {createStock.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Mouvement de stock */}
      {showMovementForm && selectedDepot && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Mouvement de stock — {selectedDepot.name}</h3>
              <button className="sn-modal-close" onClick={() => setShowMovementForm(false)}>✕</button>
            </div>
            <form onSubmit={movementForm.handleSubmit(d => createMovement.mutate(d))} className="space-y-4">
              <div>
                <label className="sn-label">Article</label>
                <select {...movementForm.register('stockId')} className="sn-select">
                  <option value="">-- Sélectionner --</option>
                  {stocks.map(s => (
                    <option key={s.id} value={s.id}>{s.resourceName} ({s.quantityAvailable} {s.unit} dispo)</option>
                  ))}
                </select>
                {movementForm.formState.errors.stockId && <p className="sn-field-error">{movementForm.formState.errors.stockId.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sn-label">Type de mouvement</label>
                  <select {...movementForm.register('movementType')} className="sn-select">
                    {Object.entries(MOVEMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="sn-label">Quantité</label>
                  <input type="number" step="any" {...movementForm.register('quantity')} className="sn-input" />
                  {movementForm.formState.errors.quantity && <p className="sn-field-error">{movementForm.formState.errors.quantity.message}</p>}
                </div>
              </div>
              <div>
                <label className="sn-label">Motif (optionnel)</label>
                <input {...movementForm.register('reason')} placeholder="ex: Livraison UNICEF, Distribution zone X" className="sn-input" />
              </div>
              <div className="sn-modal-actions">
                <button type="button" onClick={() => setShowMovementForm(false)} className="sn-btn-secondary flex-1">Annuler</button>
                <button type="submit" disabled={createMovement.isPending} className="sn-btn-primary flex-1">
                  {createMovement.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Nouvelle demande */}
      {showDemandForm && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal-lg">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Nouvelle demande de ressources</h3>
              <button className="sn-modal-close" onClick={() => setShowDemandForm(false)}>✕</button>
            </div>
            <form onSubmit={demandForm.handleSubmit(d => createDemand.mutate(d))} className="space-y-4">
              <div>
                <label className="sn-label">Crise concernée *</label>
                <select {...demandForm.register('crisisId')} className="sn-select">
                  <option value="">-- Sélectionner une crise active --</option>
                  {(crisesData ?? []).map(c => (
                    <option key={c.id} value={c.id}>[{c.glideNumber}] {c.title}</option>
                  ))}
                </select>
                {demandForm.formState.errors.crisisId && <p className="sn-field-error">{demandForm.formState.errors.crisisId.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sn-label">Type de ressource *</label>
                  <select {...demandForm.register('resourceType')} className="sn-select">
                    <option value="">-- Sélectionner --</option>
                    {Object.entries(RESOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {demandForm.formState.errors.resourceType && <p className="sn-field-error">{demandForm.formState.errors.resourceType.message}</p>}
                </div>
                <div>
                  <label className="sn-label">Urgence *</label>
                  <select {...demandForm.register('urgency')} className="sn-select">
                    {Object.entries(URGENCY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="sn-label">Désignation précise *</label>
                <input {...demandForm.register('resourceName')} placeholder="ex: Rations alimentaires, Kits cholera, Tentes 3 places…" className="sn-input" />
                {demandForm.formState.errors.resourceName && <p className="sn-field-error">{demandForm.formState.errors.resourceName.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sn-label">Quantité nécessaire *</label>
                  <input type="number" step="any" {...demandForm.register('quantityNeeded')} className="sn-input" />
                  {demandForm.formState.errors.quantityNeeded && <p className="sn-field-error">{demandForm.formState.errors.quantityNeeded.message}</p>}
                </div>
                <div>
                  <label className="sn-label">Unité *</label>
                  <input {...demandForm.register('unit')} placeholder="sac, litre, kit, tente…" className="sn-input" />
                  {demandForm.formState.errors.unit && <p className="sn-field-error">{demandForm.formState.errors.unit.message}</p>}
                </div>
              </div>

              <div>
                <label className="sn-label">Notes / justification (optionnel)</label>
                <textarea {...demandForm.register('notes')} rows={2} className="sn-textarea" placeholder="Contexte, zone d'affectation prévue…" />
              </div>

              {createDemand.isError && (
                <p className="sn-alert-danger text-xs">Erreur lors de la création. Vérifiez les informations.</p>
              )}

              <div className="sn-modal-actions">
                <button type="button" onClick={() => setShowDemandForm(false)} className="sn-btn-secondary flex-1">Annuler</button>
                <button type="submit" disabled={createDemand.isPending} className="sn-btn-primary flex-1">
                  {createDemand.isPending ? 'Envoi…' : 'Soumettre la demande'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Rejeter une demande */}
      {rejectId && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Motif du rejet</h3>
              <button className="sn-modal-close" onClick={() => setRejectId(null)}>✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="sn-label">Motif (optionnel)</label>
                <textarea
                  value={rejectNotes}
                  onChange={e => setRejectNotes(e.target.value)}
                  rows={3}
                  className="sn-textarea"
                  placeholder="Expliquez pourquoi la demande est rejetée…"
                />
              </div>
              <div className="sn-modal-actions">
                <button type="button" onClick={() => setRejectId(null)} className="sn-btn-secondary flex-1">Annuler</button>
                <button
                  onClick={() => rejectDemand.mutate({ id: rejectId, notes: rejectNotes })}
                  disabled={rejectDemand.isPending}
                  className="sn-btn-danger flex-1"
                >
                  {rejectDemand.isPending ? 'Rejet…' : 'Confirmer le rejet'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
