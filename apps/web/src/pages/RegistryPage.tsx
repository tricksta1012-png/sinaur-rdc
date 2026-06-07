import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api.js'

type BeneficiaryStatus = 'pending' | 'under_validation' | 'validated' | 'rejected' | 'duplicate'
type VulnerabilityLevel = 'low' | 'medium' | 'high' | 'critical'

interface Beneficiary {
  id: string
  registrationNumber: string
  headFirstName?: string
  headLastName?: string
  status: BeneficiaryStatus
  vulnerabilityLevel: VulnerabilityLevel
  householdSize: number
  locationPcode: string
  locationName: string
  disasterType: string
  currentValidationStep: string
  registeredAt: string
  registeredByName?: string
}

const STATUS_LABELS: Record<BeneficiaryStatus, string> = {
  pending: 'En attente',
  under_validation: 'En validation',
  validated: 'Validé',
  rejected: 'Rejeté',
  duplicate: 'Doublon',
}

const STATUS_COLORS: Record<BeneficiaryStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  under_validation: 'bg-blue-100 text-blue-800',
  validated: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  duplicate: 'bg-gray-100 text-gray-600',
}

const VULN_COLORS: Record<VulnerabilityLevel, string> = {
  low: 'text-green-600',
  medium: 'text-yellow-600',
  high: 'text-orange-600',
  critical: 'text-red-700 font-bold',
}

const STEP_LABELS: Record<string, string> = {
  neighborhood_chief: 'Chef quartier',
  village_chief: 'Chef village',
  mayor: 'Maire',
  territory_admin: 'Admin territoire',
  humanitarian_partner: 'Partenaire humanitaire',
  complete: 'Complet',
}

export function RegistryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [vulnerability, setVulnerability] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showValidateModal, setShowValidateModal] = useState(false)
  const [validationNote, setValidationNote] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['beneficiaries', { search, status, vulnerability, page }],
    queryFn: () =>
      apiClient.get('/beneficiaries', {
        params: { search: search || undefined, status: status || undefined, vulnerability: vulnerability || undefined, page, limit: 25 },
      }).then(r => r.data),
    placeholderData: (prev) => prev,
  })

  const validateMutation = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      apiClient.post(`/beneficiaries/${id}/validate`, { approved, notes: validationNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beneficiaries'] })
      setShowValidateModal(false)
      setSelectedId(null)
      setValidationNote('')
    },
  })

  const beneficiaries: Beneficiary[] = data?.data ?? []
  const pagination = data?.pagination

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Registre des bénéficiaires</h1>
          <p className="text-sm text-gray-500 mt-0.5">Données protégées — accès restreint selon rôle et périmètre géographique</p>
        </div>
        <button
          onClick={() => navigate('/registry/new')}
          className="px-4 py-2 bg-red-700 text-white rounded-lg text-sm font-medium hover:bg-red-800 transition-colors"
        >
          + Enregistrer un bénéficiaire
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Rechercher (nom, numéro)..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-72 focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={vulnerability}
          onChange={e => { setVulnerability(e.target.value); setPage(1) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
        >
          <option value="">Toutes vulnérabilités</option>
          <option value="critical">Critique</option>
          <option value="high">Élevée</option>
          <option value="medium">Moyenne</option>
          <option value="low">Faible</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">N° Enreg.</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Chef ménage</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Statut</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Vulnérabilité</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Pers.</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Zone</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Étape validation</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Enregistré le</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Chargement...</td></tr>
            )}
            {!isLoading && beneficiaries.length === 0 && (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Aucun bénéficiaire trouvé</td></tr>
            )}
            {beneficiaries.map(b => (
              <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{b.registrationNumber}</td>
                <td className="px-4 py-3 font-medium text-gray-900">
                  {b.headFirstName && b.headLastName
                    ? `${b.headFirstName} ${b.headLastName}`
                    : <span className="text-gray-400 italic">Masqué</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[b.status]}`}>
                    {STATUS_LABELS[b.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${VULN_COLORS[b.vulnerabilityLevel]}`}>
                    {b.vulnerabilityLevel === 'critical' ? 'CRITIQUE' : b.vulnerabilityLevel}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{b.householdSize}</td>
                <td className="px-4 py-3 text-gray-700">{b.locationPcode}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {b.status === 'validated' ? '✓ Validé' : STEP_LABELS[b.currentValidationStep] ?? b.currentValidationStep}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(b.registeredAt).toLocaleDateString('fr-FR')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/registry/${b.id}`)}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      Voir
                    </button>
                    {(b.status === 'pending' || b.status === 'under_validation') && (
                      <button
                        onClick={() => { setSelectedId(b.id); setShowValidateModal(true) }}
                        className="text-xs text-green-600 hover:text-green-800 font-medium"
                      >
                        Valider
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {pagination && pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-500">{pagination.total} bénéficiaires</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">
                Précédent
              </button>
              <span className="px-3 py-1.5 text-gray-600">{page} / {pagination.pages}</span>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages}
                className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal validation */}
      {showValidateModal && selectedId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowValidateModal(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Validation du bénéficiaire</h3>
            <textarea
              value={validationNote}
              onChange={e => setValidationNote(e.target.value)}
              placeholder="Note de validation (optionnel)..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-3">
              <button
                onClick={() => validateMutation.mutate({ id: selectedId, approved: true })}
                disabled={validateMutation.isPending}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                Approuver
              </button>
              <button
                onClick={() => validateMutation.mutate({ id: selectedId, approved: false })}
                disabled={validateMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                Rejeter
              </button>
              <button
                onClick={() => setShowValidateModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
