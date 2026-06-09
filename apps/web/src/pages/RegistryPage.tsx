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

const STATUS_BADGE: Record<BeneficiaryStatus, string> = {
  pending:          'sn-badge-yellow',
  under_validation: 'sn-badge-blue',
  validated:        'sn-badge-green',
  rejected:         'sn-badge-red',
  duplicate:        'sn-badge-gray',
}

const VULN_CLASSES: Record<VulnerabilityLevel, string> = {
  low:      'text-green-600',
  medium:   'text-yellow-600',
  high:     'text-orange-600',
  critical: 'text-red-700 font-bold',
}

const STEP_LABELS: Record<string, string> = {
  neighborhood_chief: 'Chef quartier',
  village_chief:      'Chef village',
  mayor:              'Maire',
  territory_admin:    'Admin territoire',
  humanitarian_partner: 'Partenaire humanitaire',
  complete:           'Complet',
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
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Registre des bénéficiaires</h1>
          <p className="sn-page-subtitle">Données protégées — accès restreint selon rôle et périmètre géographique</p>
        </div>
        <button onClick={() => navigate('/registry/new')} className="sn-btn-primary">
          + Enregistrer
        </button>
      </div>

      {/* Filtres */}
      <div className="sn-filter-bar">
        <input
          type="text"
          placeholder="Rechercher (nom, numéro)…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="sn-input w-72"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="sn-select w-auto"
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={vulnerability}
          onChange={e => { setVulnerability(e.target.value); setPage(1) }}
          className="sn-select w-auto"
        >
          <option value="">Toutes vulnérabilités</option>
          <option value="critical">Critique</option>
          <option value="high">Élevée</option>
          <option value="medium">Moyenne</option>
          <option value="low">Faible</option>
        </select>
      </div>

      {/* Table */}
      <div className="sn-table-wrap">
        <table className="sn-table">
          <thead>
            <tr>
              <th>N° Enreg.</th>
              <th>Chef ménage</th>
              <th>Statut</th>
              <th>Vulnérabilité</th>
              <th className="text-right">Pers.</th>
              <th>Zone</th>
              <th>Étape validation</th>
              <th>Enregistré le</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="sn-empty">Chargement…</td></tr>
            )}
            {!isLoading && beneficiaries.length === 0 && (
              <tr><td colSpan={9} className="sn-empty">Aucun bénéficiaire trouvé</td></tr>
            )}
            {beneficiaries.map(b => (
              <tr key={b.id}>
                <td className="font-mono text-xs text-gray-500">{b.registrationNumber}</td>
                <td className="font-medium text-gray-900">
                  {b.headFirstName && b.headLastName
                    ? `${b.headFirstName} ${b.headLastName}`
                    : <span className="text-gray-400 italic text-xs">Masqué</span>
                  }
                </td>
                <td>
                  <span className={STATUS_BADGE[b.status]}>
                    {STATUS_LABELS[b.status]}
                  </span>
                </td>
                <td>
                  <span className={`text-xs font-medium ${VULN_CLASSES[b.vulnerabilityLevel]}`}>
                    {b.vulnerabilityLevel === 'critical' ? 'CRITIQUE' : b.vulnerabilityLevel}
                  </span>
                </td>
                <td className="text-right tabular-nums">{b.householdSize}</td>
                <td className="text-xs text-gray-500">{b.locationPcode}</td>
                <td className="text-xs text-gray-500">
                  {b.status === 'validated' ? (
                    <span className="text-green-600 font-medium">✓ Validé</span>
                  ) : (
                    STEP_LABELS[b.currentValidationStep] ?? b.currentValidationStep
                  )}
                </td>
                <td className="text-xs text-gray-500 whitespace-nowrap">
                  {new Date(b.registeredAt).toLocaleDateString('fr-FR')}
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => navigate(`/registry/${b.id}`)}
                      className="sn-btn-link-blue"
                    >
                      Voir
                    </button>
                    {(b.status === 'pending' || b.status === 'under_validation') && (
                      <button
                        onClick={() => { setSelectedId(b.id); setShowValidateModal(true) }}
                        className="sn-btn-link-green"
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">{pagination.total} bénéficiaires</span>
            <div className="sn-pagination">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="sn-page-btn">
                Précédent
              </button>
              <span className="text-sm text-gray-600 px-2">{page} / {pagination.pages}</span>
              <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page === pagination.pages} className="sn-page-btn">
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal validation */}
      {showValidateModal && selectedId && (
        <div className="sn-modal-backdrop" onClick={() => setShowValidateModal(false)}>
          <div className="sn-modal" onClick={e => e.stopPropagation()}>
            <div className="sn-modal-header">
              <h3 className="sn-modal-title">Validation du bénéficiaire</h3>
              <button className="sn-modal-close" onClick={() => setShowValidateModal(false)}>✕</button>
            </div>
            <textarea
              value={validationNote}
              onChange={e => setValidationNote(e.target.value)}
              placeholder="Note de validation (optionnel)…"
              rows={3}
              className="sn-textarea"
            />
            <div className="flex gap-3">
              <button
                onClick={() => validateMutation.mutate({ id: selectedId, approved: true })}
                disabled={validateMutation.isPending}
                className="sn-btn-success flex-1"
              >
                Approuver
              </button>
              <button
                onClick={() => validateMutation.mutate({ id: selectedId, approved: false })}
                disabled={validateMutation.isPending}
                className="sn-btn-danger flex-1"
              >
                Rejeter
              </button>
              <button
                onClick={() => setShowValidateModal(false)}
                className="sn-btn-secondary"
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
