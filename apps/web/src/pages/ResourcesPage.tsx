import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../lib/api.js'

type ResourceType = 'food' | 'water' | 'medicine' | 'shelter_kit' | 'nfi' | 'hygiene_kit' | 'fuel' | 'equipment' | 'other'
type MovementType = 'in' | 'out' | 'transfer' | 'adjustment'

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

const RESOURCE_LABELS: Record<ResourceType, string> = {
  food: 'Vivres', water: 'Eau', medicine: 'Médicaments',
  shelter_kit: 'Kit abri', nfi: 'Articles NFI', hygiene_kit: "Kit hygiène",
  fuel: 'Carburant', equipment: 'Équipement', other: 'Autre',
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  in: 'Entrée', out: 'Sortie', transfer: 'Transfert', adjustment: 'Ajustement',
}

const MOVEMENT_COLORS: Record<MovementType, string> = {
  in: 'text-green-600', out: 'text-red-600', transfer: 'text-blue-600', adjustment: 'text-yellow-600',
}

const DepotSchema = z.object({
  name: z.string().min(2, 'Nom requis'),
  pcode: z.string().min(2, 'P-code requis'),
  address: z.string().optional(),
})

const StockSchema = z.object({
  resourceType: z.string().min(1, 'Type requis'),
  resourceName: z.string().min(2, 'Nom requis'),
  unit: z.string().min(1, 'Unité requise'),
  quantityAvailable: z.coerce.number().min(0),
  minimumThreshold: z.coerce.number().min(0).default(0),
})

const MovementSchema = z.object({
  stockId: z.string().uuid('Sélectionnez un article'),
  movementType: z.string().min(1),
  quantity: z.coerce.number().positive('Quantité invalide'),
  reason: z.string().optional(),
})

type DepotForm = z.infer<typeof DepotSchema>
type StockForm = z.infer<typeof StockSchema>
type MovementForm = z.infer<typeof MovementSchema>

export function ResourcesPage() {
  const qc = useQueryClient()
  const [selectedDepot, setSelectedDepot] = useState<Depot | null>(null)
  const [showDepotForm, setShowDepotForm] = useState(false)
  const [showStockForm, setShowStockForm] = useState(false)
  const [showMovementForm, setShowMovementForm] = useState(false)

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

  const depotForm = useForm<DepotForm>({ resolver: zodResolver(DepotSchema) })
  const stockForm = useForm<StockForm>({ resolver: zodResolver(StockSchema) })
  const movementForm = useForm<MovementForm>({ resolver: zodResolver(MovementSchema) })

  const createDepot = useMutation({
    mutationFn: (data: DepotForm) => apiClient.post('/resources/depots', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-depots'] }); setShowDepotForm(false); depotForm.reset() },
  })

  const createStock = useMutation({
    mutationFn: (data: StockForm) => apiClient.post(`/resources/depots/${selectedDepot!.id}/stocks`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-depot', selectedDepot?.id] }); qc.invalidateQueries({ queryKey: ['resource-depots'] }); setShowStockForm(false); stockForm.reset() },
  })

  const createMovement = useMutation({
    mutationFn: (data: MovementForm) => apiClient.post(`/resources/depots/${selectedDepot!.id}/movements`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-depot', selectedDepot?.id] }); qc.invalidateQueries({ queryKey: ['resource-depots'] }); qc.invalidateQueries({ queryKey: ['resource-alerts'] }); setShowMovementForm(false); movementForm.reset() },
  })

  const depots = depotsData ?? []
  const alerts = alertsData ?? []
  const stocks = depotDetail?.stocks ?? selectedDepot?.stocks ?? []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ressources & Stocks</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gestion des dépôts et stocks humanitaires</p>
        </div>
        <button
          onClick={() => setShowDepotForm(true)}
          className="bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-800 transition-colors"
        >
          + Nouveau dépôt
        </button>
      </div>

      {/* Alertes stocks critiques */}
      {alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-red-800 mb-2">Stocks sous le seuil minimum ({alerts.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {alerts.map(a => (
              <div key={a.stockId} className="bg-white rounded-lg p-3 border border-red-100 text-xs">
                <div className="font-medium text-gray-900">{a.resourceName}</div>
                <div className="text-gray-500">{a.depotName} • {a.pcode}</div>
                <div className="mt-1">
                  <span className="text-red-600 font-semibold">{a.quantityAvailable} {a.unit}</span>
                  <span className="text-gray-400"> / seuil {a.minimumThreshold}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Liste des dépôts */}
        <div className="lg:col-span-1 space-y-3">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">Dépôts</h2>
          {isLoading ? (
            <div className="text-sm text-gray-400 py-4 text-center">Chargement…</div>
          ) : depots.length === 0 ? (
            <div className="text-sm text-gray-400 py-4 text-center">Aucun dépôt enregistré</div>
          ) : (
            depots.map(depot => (
              <button
                key={depot.id}
                onClick={() => setSelectedDepot(depot)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  selectedDepot?.id === depot.id
                    ? 'border-red-600 bg-red-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-gray-900 text-sm">{depot.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{depot.pcode}</div>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${depot.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
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

        {/* Détail dépôt sélectionné */}
        <div className="lg:col-span-2">
          {!selectedDepot ? (
            <div className="flex items-center justify-center h-64 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-gray-400 text-sm">Sélectionnez un dépôt pour voir ses stocks</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{depotDetail?.name ?? selectedDepot.name}</h2>
                    <p className="text-sm text-gray-500">{depotDetail?.pcode ?? selectedDepot.pcode} {depotDetail?.address ? `• ${depotDetail.address}` : ''}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowMovementForm(true)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
                    >
                      + Mouvement
                    </button>
                    <button
                      onClick={() => setShowStockForm(true)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-700 text-white hover:bg-red-800 font-medium"
                    >
                      + Article
                    </button>
                  </div>
                </div>

                {stocks.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">Aucun article en stock</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Article</th>
                          <th className="text-left py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
                          <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Disponible</th>
                          <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Réservé</th>
                          <th className="text-right py-2 text-xs font-semibold text-gray-500 uppercase">Seuil</th>
                          <th className="text-center py-2 text-xs font-semibold text-gray-500 uppercase">État</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stocks.map(s => {
                          const isLow = s.minimumThreshold > 0 && s.quantityAvailable <= s.minimumThreshold
                          return (
                            <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2.5 font-medium text-gray-900">{s.resourceName}</td>
                              <td className="py-2.5 text-gray-500">{RESOURCE_LABELS[s.resourceType] ?? s.resourceType}</td>
                              <td className="py-2.5 text-right font-medium">{s.quantityAvailable.toLocaleString()} {s.unit}</td>
                              <td className="py-2.5 text-right text-gray-500">{s.quantityReserved.toLocaleString()}</td>
                              <td className="py-2.5 text-right text-gray-500">{s.minimumThreshold > 0 ? s.minimumThreshold.toLocaleString() : '—'}</td>
                              <td className="py-2.5 text-center">
                                {isLow
                                  ? <span className="inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">Bas</span>
                                  : <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">OK</span>
                                }
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal — Nouveau dépôt */}
      {showDepotForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Nouveau dépôt</h3>
            <form onSubmit={depotForm.handleSubmit(d => createDepot.mutate(d))} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du dépôt</label>
                <input {...depotForm.register('name')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                {depotForm.formState.errors.name && <p className="text-xs text-red-600 mt-1">{depotForm.formState.errors.name.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">P-code province</label>
                <input {...depotForm.register('pcode')} placeholder="ex: CD-KN" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                {depotForm.formState.errors.pcode && <p className="text-xs text-red-600 mt-1">{depotForm.formState.errors.pcode.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse (optionnel)</label>
                <input {...depotForm.register('address')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowDepotForm(false)} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-medium hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={createDepot.isPending} className="flex-1 bg-red-700 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-800 disabled:opacity-50">
                  {createDepot.isPending ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Nouvel article */}
      {showStockForm && selectedDepot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Ajouter un article — {selectedDepot.name}</h3>
            <form onSubmit={stockForm.handleSubmit(d => createStock.mutate(d))} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select {...stockForm.register('resourceType')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="">-- Sélectionner --</option>
                  {Object.entries(RESOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {stockForm.formState.errors.resourceType && <p className="text-xs text-red-600 mt-1">{stockForm.formState.errors.resourceType.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'article</label>
                <input {...stockForm.register('resourceName')} placeholder="ex: Riz 25kg, Savon" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                {stockForm.formState.errors.resourceName && <p className="text-xs text-red-600 mt-1">{stockForm.formState.errors.resourceName.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unité</label>
                  <input {...stockForm.register('unit')} placeholder="ex: sac, litre, boîte" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantité initiale</label>
                  <input type="number" {...stockForm.register('quantityAvailable')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seuil minimum d'alerte</label>
                <input type="number" {...stockForm.register('minimumThreshold')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowStockForm(false)} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-medium hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={createStock.isPending} className="flex-1 bg-red-700 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-800 disabled:opacity-50">
                  {createStock.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Mouvement de stock */}
      {showMovementForm && selectedDepot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Mouvement de stock — {selectedDepot.name}</h3>
            <form onSubmit={movementForm.handleSubmit(d => createMovement.mutate(d))} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Article</label>
                <select {...movementForm.register('stockId')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="">-- Sélectionner --</option>
                  {stocks.map(s => (
                    <option key={s.id} value={s.id}>{s.resourceName} ({s.quantityAvailable} {s.unit} dispo)</option>
                  ))}
                </select>
                {movementForm.formState.errors.stockId && <p className="text-xs text-red-600 mt-1">{movementForm.formState.errors.stockId.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select {...movementForm.register('movementType')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                    {Object.entries(MOVEMENT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
                  <input type="number" step="any" {...movementForm.register('quantity')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  {movementForm.formState.errors.quantity && <p className="text-xs text-red-600 mt-1">{movementForm.formState.errors.quantity.message}</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motif (optionnel)</label>
                <input {...movementForm.register('reason')} placeholder="ex: Livraison UNICEF, Distribution zone X" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowMovementForm(false)} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-medium hover:bg-gray-50">Annuler</button>
                <button type="submit" disabled={createMovement.isPending} className="flex-1 bg-red-700 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-800 disabled:opacity-50">
                  {createMovement.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
