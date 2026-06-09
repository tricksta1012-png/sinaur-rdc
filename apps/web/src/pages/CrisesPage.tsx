import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../lib/api.js'
import { useAuthStore } from '../stores/auth.js'

type CrisisStatus = 'active' | 'contained' | 'closed'
type DemandStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled'
type DemandUrgency = 'low' | 'normal' | 'high' | 'critical'

interface Crisis {
  id: string
  glideNumber: string
  title: string
  hazardType: string
  status: CrisisStatus
  severity: string
  startDate: string
  endDate: string | null
  locationName: string | null
  locationPcode: string | null
  affectedCount: number | null
  displacedCount: number | null
  deathsCount: number | null
  responseLead: string | null
  description: string | null
  openTasks: number
  sitrepCount: number
  createdAt: string
}

interface Demand {
  id: string
  resourceType: string
  resourceName: string
  unit: string
  quantityNeeded: string
  quantityAllocated: string | null
  urgency: DemandUrgency
  status: DemandStatus
  notes: string | null
  requestedByName: string | null
  depotName: string | null
  createdAt: string
}

const HAZARD_ICONS: Record<string, string> = {
  flood: '🌊', landslide: '⛰️', mass_displacement: '🏃',
  humanitarian_crisis: '🆘', health_epidemic: '🦠', volcanic_eruption: '🌋',
  drought: '☀️', fire: '🔥', conflict: '⚔️', earthquake: '📳', other: '⚠️',
}

const HAZARD_LABELS: Record<string, string> = {
  flood: 'Inondation', landslide: 'Glissement', mass_displacement: 'Déplacement',
  humanitarian_crisis: 'Crise humanitaire', health_epidemic: 'Épidémie',
  volcanic_eruption: 'Éruption', drought: 'Sécheresse', fire: 'Incendie',
  conflict: 'Conflit', earthquake: 'Séisme', other: 'Autre',
}

const STATUS_BADGE: Record<CrisisStatus, string> = {
  active:    'sn-badge-red',
  contained: 'sn-badge-yellow',
  closed:    'sn-badge-gray',
}

const STATUS_LABELS: Record<CrisisStatus, string> = {
  active: 'Active', contained: 'Maîtrisée', closed: 'Clôturée',
}

const URGENCY_BADGE: Record<DemandUrgency, string> = {
  critical: 'sn-badge-dark', high: 'sn-badge-red', normal: 'sn-badge-blue', low: 'sn-badge-gray',
}
const URGENCY_LABELS: Record<DemandUrgency, string> = {
  critical: 'Critique', high: 'Haute', normal: 'Normale', low: 'Faible',
}

const DEMAND_STATUS_BADGE: Record<DemandStatus, string> = {
  pending: 'sn-badge-yellow', approved: 'sn-badge-green',
  rejected: 'sn-badge-red', fulfilled: 'sn-badge-gray',
}
const DEMAND_STATUS_LABELS: Record<DemandStatus, string> = {
  pending: 'En attente', approved: 'Approuvée', rejected: 'Rejetée', fulfilled: 'Réalisée',
}

const SEVERITY_BADGE: Record<string, string> = {
  Minor: 'sn-badge-yellow', Moderate: 'sn-badge-orange',
  Severe: 'sn-badge-red', Extreme: 'sn-badge-dark', Unknown: 'sn-badge-gray',
}

const CrisisSchema = z.object({
  title:          z.string().min(3, 'Titre requis (min 3 caractères)'),
  hazardType:     z.string().min(1, 'Type requis'),
  severity:       z.enum(['Minor', 'Moderate', 'Severe', 'Extreme', 'Unknown']).default('Severe'),
  locationPcode:  z.string().optional(),
  affectedCount:  z.coerce.number().int().min(0).optional().or(z.literal('')),
  displacedCount: z.coerce.number().int().min(0).optional().or(z.literal('')),
  deathsCount:    z.coerce.number().int().min(0).optional().or(z.literal('')),
  responseLead:   z.string().optional(),
  description:    z.string().max(2000).optional(),
})

type CrisisForm = z.infer<typeof CrisisSchema>

function formatNumber(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('fr-FR')
}

export function CrisesPage() {
  const qc = useQueryClient()
  const userRole = useAuthStore(s => s.user?.role)
  const canCreate = userRole === 'system_admin' || userRole === 'national_decision_maker' || userRole === 'territory_admin'
  const canApprove = userRole === 'system_admin' || userRole === 'national_decision_maker'

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [selected, setSelected]         = useState<Crisis | null>(null)
  const [showForm, setShowForm]         = useState(false)
  const [detailTab, setDetailTab]       = useState<'info' | 'demands'>('info')

  const { data: crisesData, isLoading } = useQuery({
    queryKey: ['crises', statusFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' })
      if (statusFilter) params.set('status', statusFilter)
      return apiClient.get<{ success: boolean; data: Crisis[] }>(`/crises?${params}`).then(r => r.data.data)
    },
  })

  const { data: demandsData } = useQuery({
    queryKey: ['crisis-demands', selected?.id],
    queryFn: () => apiClient.get<{ success: boolean; data: Demand[] }>(`/resources/crises/${selected!.id}/demands`).then(r => r.data.data),
    enabled: !!selected && detailTab === 'demands',
  })

  const crisisForm = useForm<CrisisForm>({
    resolver: zodResolver(CrisisSchema),
    defaultValues: { severity: 'Severe', hazardType: 'flood' },
  })

  const createCrisis = useMutation({
    mutationFn: (data: CrisisForm) => apiClient.post('/crises', {
      ...data,
      affectedCount:  data.affectedCount  || undefined,
      displacedCount: data.displacedCount || undefined,
      deathsCount:    data.deathsCount    || undefined,
      locationPcode:  data.locationPcode  || undefined,
      responseLead:   data.responseLead   || undefined,
      description:    data.description    || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crises'] })
      setShowForm(false)
      crisisForm.reset()
    },
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/crises/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crises'] })
      if (selected) setSelected(prev => prev ? { ...prev, status: (selected as any).status } : null)
    },
  })

  const approveDemand = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/resources/demands/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crisis-demands', selected?.id] }),
  })

  const fulfillDemand = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/resources/demands/${id}/fulfill`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crisis-demands', selected?.id] }),
  })

  const crises  = crisesData ?? []
  const demands = demandsData ?? []

  const pendingDemands = demands.filter(d => d.status === 'pending').length

  return (
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Crises humanitaires</h1>
          <p className="sn-page-subtitle">
            Gestion du cycle de vie des crises · Numéros GLIDE · Demandes de ressources
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} className="sn-btn-primary">
            + Ouvrir une crise
          </button>
        )}
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {(['', 'active', 'contained', 'closed'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              statusFilter === s
                ? 'bg-sinaur-700 text-white border-sinaur-700'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {s === '' ? 'Toutes' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Crisis list */}
        <div className={`${selected ? 'lg:col-span-2' : 'lg:col-span-5'} space-y-3`}>
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="sn-skeleton h-24 rounded-xl" />)}
            </div>
          ) : crises.length === 0 ? (
            <div className="sn-empty">Aucune crise trouvée</div>
          ) : (
            <div className={selected ? 'space-y-2' : 'sn-table-wrap'}>
              {selected ? (
                crises.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelected(c); setDetailTab('info') }}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selected?.id === c.id
                        ? 'border-sinaur-600 bg-sinaur-50 ring-1 ring-sinaur-200'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span>{HAZARD_ICONS[c.hazardType] ?? '⚠️'}</span>
                          <span className="font-mono text-xs text-gray-400">{c.glideNumber}</span>
                        </div>
                        <div className="font-medium text-gray-900 text-sm truncate">{c.title}</div>
                      </div>
                      <span className={`${STATUS_BADGE[c.status]} shrink-0`}>{STATUS_LABELS[c.status]}</span>
                    </div>
                  </button>
                ))
              ) : (
                <table className="sn-table">
                  <thead>
                    <tr>
                      <th>GLIDE / Titre</th>
                      <th>Type</th>
                      <th>Sévérité</th>
                      <th>Statut</th>
                      <th className="text-right">Affectés</th>
                      <th className="text-right">Déplacés</th>
                      <th className="text-right">Décès</th>
                      <th>Resp.</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {crises.map(c => (
                      <tr key={c.id}>
                        <td>
                          <div className="font-mono text-xs text-gray-400">{c.glideNumber}</div>
                          <div className="font-medium text-gray-900 max-w-xs truncate">{c.title}</div>
                        </td>
                        <td>
                          <span className="text-base mr-1">{HAZARD_ICONS[c.hazardType] ?? '⚠️'}</span>
                          <span className="text-xs text-gray-500">{HAZARD_LABELS[c.hazardType] ?? c.hazardType}</span>
                        </td>
                        <td>
                          <span className={SEVERITY_BADGE[c.severity] ?? 'sn-badge-gray'}>{c.severity}</span>
                        </td>
                        <td>
                          <span className={STATUS_BADGE[c.status]}>{STATUS_LABELS[c.status]}</span>
                        </td>
                        <td className="text-right text-sm">{formatNumber(c.affectedCount)}</td>
                        <td className="text-right text-sm text-gray-500">{formatNumber(c.displacedCount)}</td>
                        <td className="text-right text-sm text-gray-500">{formatNumber(c.deathsCount)}</td>
                        <td className="text-xs text-gray-500 max-w-[120px] truncate">{c.responseLead ?? '—'}</td>
                        <td className="text-xs text-gray-400 whitespace-nowrap">
                          {new Date(c.startDate).toLocaleDateString('fr-FR')}
                        </td>
                        <td>
                          <button
                            onClick={() => { setSelected(c); setDetailTab('info') }}
                            className="sn-btn-link-blue"
                          >
                            Détail →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Crisis detail panel */}
        {selected && (
          <div className="lg:col-span-3">
            <div className="sn-card">
              <div className="sn-card-header">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{HAZARD_ICONS[selected.hazardType] ?? '⚠️'}</span>
                    <span className="font-mono text-xs text-gray-400">{selected.glideNumber}</span>
                    <span className={STATUS_BADGE[selected.status]}>{STATUS_LABELS[selected.status]}</span>
                    <span className={SEVERITY_BADGE[selected.severity] ?? 'sn-badge-gray'}>{selected.severity}</span>
                  </div>
                  <h2 className="font-semibold text-gray-900 truncate">{selected.title}</h2>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canCreate && selected.status === 'active' && (
                    <button
                      onClick={() => updateStatus.mutate({ id: selected.id, status: 'contained' })}
                      disabled={updateStatus.isPending}
                      className="sn-btn-secondary-sm"
                    >
                      Maîtriser
                    </button>
                  )}
                  {canCreate && selected.status === 'contained' && (
                    <button
                      onClick={() => updateStatus.mutate({ id: selected.id, status: 'closed' })}
                      disabled={updateStatus.isPending}
                      className="sn-btn-secondary-sm"
                    >
                      Clôturer
                    </button>
                  )}
                  <button
                    onClick={() => setSelected(null)}
                    className="sn-modal-close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 p-3 border-b border-gray-100 bg-gray-50">
                <button
                  onClick={() => setDetailTab('info')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    detailTab === 'info' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Informations
                </button>
                <button
                  onClick={() => setDetailTab('demands')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    detailTab === 'demands' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Demandes
                  {pendingDemands > 0 && detailTab !== 'demands' && (
                    <span className="w-4 h-4 text-[10px] font-bold bg-sinaur-700 text-white rounded-full flex items-center justify-center">
                      {pendingDemands}
                    </span>
                  )}
                </button>
              </div>

              {/* Info tab */}
              {detailTab === 'info' && (
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <p className="sn-section-label mb-1">Province</p>
                      <p className="text-gray-900">{selected.locationName ?? selected.locationPcode ?? '—'}</p>
                    </div>
                    <div>
                      <p className="sn-section-label mb-1">Chef de file</p>
                      <p className="text-gray-900">{selected.responseLead ?? '—'}</p>
                    </div>
                    <div>
                      <p className="sn-section-label mb-1">Personnes affectées</p>
                      <p className="text-gray-900 font-medium">{formatNumber(selected.affectedCount)}</p>
                    </div>
                    <div>
                      <p className="sn-section-label mb-1">Déplacées</p>
                      <p className="text-gray-900 font-medium">{formatNumber(selected.displacedCount)}</p>
                    </div>
                    <div>
                      <p className="sn-section-label mb-1">Décès</p>
                      <p className="text-gray-900 font-medium">{formatNumber(selected.deathsCount)}</p>
                    </div>
                    <div>
                      <p className="sn-section-label mb-1">Date début</p>
                      <p className="text-gray-900">{new Date(selected.startDate).toLocaleDateString('fr-FR')}</p>
                    </div>
                    {selected.endDate && (
                      <div>
                        <p className="sn-section-label mb-1">Date fin</p>
                        <p className="text-gray-900">{new Date(selected.endDate).toLocaleDateString('fr-FR')}</p>
                      </div>
                    )}
                    <div>
                      <p className="sn-section-label mb-1">Tâches ouvertes</p>
                      <p className="text-gray-900">{selected.openTasks}</p>
                    </div>
                    <div>
                      <p className="sn-section-label mb-1">SitReps</p>
                      <p className="text-gray-900">{selected.sitrepCount}</p>
                    </div>
                  </div>
                  {selected.description && (
                    <div>
                      <p className="sn-section-label mb-1">Description</p>
                      <p className="text-sm text-gray-700 leading-relaxed">{selected.description}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Demands tab */}
              {detailTab === 'demands' && (
                <div>
                  {demands.length === 0 ? (
                    <div className="sn-empty">Aucune demande pour cette crise</div>
                  ) : (
                    <table className="sn-table">
                      <thead>
                        <tr>
                          <th>Ressource</th>
                          <th className="text-right">Quantité</th>
                          <th>Urgence</th>
                          <th>Statut</th>
                          <th>Dépôt</th>
                          {canApprove && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {demands.map(d => (
                          <tr key={d.id}>
                            <td>
                              <div className="font-medium text-gray-900 text-xs">{d.resourceName}</div>
                              <div className="text-gray-400 text-xs">{d.requestedByName ?? '—'}</div>
                            </td>
                            <td className="text-right text-sm font-medium">
                              {Number(d.quantityNeeded).toLocaleString('fr-FR')}
                              {d.quantityAllocated && (
                                <div className="text-xs text-green-600">
                                  ✓ {Number(d.quantityAllocated).toLocaleString('fr-FR')}
                                </div>
                              )}
                              <span className="text-xs text-gray-400"> {d.unit}</span>
                            </td>
                            <td>
                              <span className={URGENCY_BADGE[d.urgency]}>{URGENCY_LABELS[d.urgency]}</span>
                            </td>
                            <td>
                              <span className={DEMAND_STATUS_BADGE[d.status]}>{DEMAND_STATUS_LABELS[d.status]}</span>
                            </td>
                            <td className="text-xs text-gray-500">{d.depotName ?? '—'}</td>
                            {canApprove && (
                              <td className="text-right">
                                {d.status === 'pending' && (
                                  <button
                                    onClick={() => approveDemand.mutate(d.id)}
                                    disabled={approveDemand.isPending}
                                    className="sn-btn-link-green"
                                  >
                                    Approuver
                                  </button>
                                )}
                                {d.status === 'approved' && (
                                  <button
                                    onClick={() => fulfillDemand.mutate(d.id)}
                                    disabled={fulfillDemand.isPending}
                                    className="sn-btn-link-blue"
                                  >
                                    Réalisée
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal — Nouvelle crise */}
      {showForm && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal-lg">
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Ouvrir une nouvelle crise</h3>
              <button className="sn-modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={crisisForm.handleSubmit(d => createCrisis.mutate(d))} className="space-y-4">
              <div>
                <label className="sn-label">Titre *</label>
                <input {...crisisForm.register('title')} placeholder="ex: Inondation critique — Nord-Kivu" className="sn-input" />
                {crisisForm.formState.errors.title && <p className="sn-field-error">{crisisForm.formState.errors.title.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sn-label">Type de hazard *</label>
                  <select {...crisisForm.register('hazardType')} className="sn-select">
                    {Object.entries(HAZARD_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{HAZARD_ICONS[v]} {l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="sn-label">Sévérité *</label>
                  <select {...crisisForm.register('severity')} className="sn-select">
                    <option value="Unknown">Inconnue</option>
                    <option value="Minor">Mineure</option>
                    <option value="Moderate">Modérée</option>
                    <option value="Severe">Sévère</option>
                    <option value="Extreme">Extrême</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sn-label">P-code province</label>
                  <input {...crisisForm.register('locationPcode')} placeholder="ex: CD-NK" className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Chef de file / Agence</label>
                  <input {...crisisForm.register('responseLead')} placeholder="ex: UNICEF, OCHA, PAM…" className="sn-input" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="sn-label">Affectés (estimation)</label>
                  <input type="number" {...crisisForm.register('affectedCount')} className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Déplacés</label>
                  <input type="number" {...crisisForm.register('displacedCount')} className="sn-input" />
                </div>
                <div>
                  <label className="sn-label">Décès</label>
                  <input type="number" {...crisisForm.register('deathsCount')} className="sn-input" />
                </div>
              </div>

              <div>
                <label className="sn-label">Description / contexte</label>
                <textarea {...crisisForm.register('description')} rows={3} className="sn-textarea" />
              </div>

              {createCrisis.isError && (
                <p className="sn-alert-danger text-xs">Erreur lors de la création. Vérifiez les champs.</p>
              )}

              <div className="sn-modal-actions">
                <button type="button" onClick={() => setShowForm(false)} className="sn-btn-secondary flex-1">Annuler</button>
                <button type="submit" disabled={createCrisis.isPending} className="sn-btn-primary flex-1">
                  {createCrisis.isPending ? 'Création…' : 'Ouvrir la crise'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
