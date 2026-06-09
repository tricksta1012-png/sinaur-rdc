import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '../lib/api.js'
import { useAuthStore } from '../stores/auth.js'

const ROLES = ['citizen', 'field_agent', 'local_validator', 'territory_admin',
               'humanitarian_partner', 'national_decision_maker', 'system_admin'] as const
type Role = typeof ROLES[number]

const ROLE_LABELS: Record<Role, string> = {
  citizen:                  'Citoyen',
  field_agent:              'Agent terrain',
  local_validator:          'Validateur local',
  territory_admin:          'Admin territoire',
  humanitarian_partner:     'Partenaire humanitaire',
  national_decision_maker:  'Décideur national',
  system_admin:             'Administrateur système',
}

const ROLE_BADGE: Record<Role, string> = {
  citizen:                 'sn-badge-gray',
  field_agent:             'sn-badge-blue',
  local_validator:         'sn-badge-teal',
  territory_admin:         'sn-badge-purple',
  humanitarian_partner:    'sn-badge-orange',
  national_decision_maker: 'sn-badge-red',
  system_admin:            'sn-badge-dark',
}

interface User {
  id: string
  email: string
  fullName: string
  phone: string | null
  role: Role
  geographicScopePcodes: string[]
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
}

const CreateSchema = z.object({
  email:                 z.string().email('Email invalide'),
  fullName:              z.string().min(2, 'Nom trop court'),
  password:              z.string().min(10, 'Au moins 10 caractères'),
  role:                  z.enum(ROLES),
  geographicScopePcodes: z.string().transform(s => s.split(',').map(p => p.trim()).filter(Boolean)),
  phone:                 z.string().optional(),
})

const EditSchema = z.object({
  role:                  z.enum(ROLES),
  geographicScopePcodes: z.string().transform(s => s.split(',').map(p => p.trim()).filter(Boolean)),
  isActive:              z.boolean(),
})

type CreateForm = z.input<typeof CreateSchema>
type EditForm   = z.input<typeof EditSchema>

export function UsersPage() {
  const { user: me } = useAuthStore()
  const qc = useQueryClient()
  const [search, setSearch]         = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage]             = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing]       = useState<User | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page, roleFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (roleFilter) params.set('role', roleFilter)
      if (search)     params.set('search', search)
      const { data } = await apiClient.get<{ data: User[]; meta: { total: number; page: number; limit: number } }>(
        `/admin/users?${params}`,
      )
      return data
    },
  })

  const createMutation = useMutation({
    mutationFn: async (body: object) => apiClient.post('/admin/users', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-users'] }); setShowCreate(false) },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: object }) => apiClient.patch(`/admin/users/${id}`, body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditing(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/admin/users/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const createForm = useForm<CreateForm>({ resolver: zodResolver(CreateSchema) })
  const editForm   = useForm<EditForm>({ resolver: zodResolver(EditSchema) })

  const openEdit = (u: User) => {
    setEditing(u)
    editForm.reset({
      role: u.role,
      geographicScopePcodes: u.geographicScopePcodes.join(', '),
      isActive: u.isActive,
    })
  }

  const users      = data?.data ?? []
  const meta       = data?.meta
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1

  return (
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Gestion des utilisateurs</h1>
          <p className="sn-page-subtitle">{meta?.total ?? '—'} utilisateur{(meta?.total ?? 0) !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="sn-btn-primary">
          + Nouvel utilisateur
        </button>
      </div>

      {/* Filtres */}
      <div className="sn-filter-bar">
        <input
          className="sn-input w-64"
          placeholder="Rechercher par nom ou email…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="sn-select w-auto"
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1) }}
        >
          <option value="">Tous les rôles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="sn-table-wrap">
        {isLoading ? (
          <div className="sn-empty">Chargement…</div>
        ) : users.length === 0 ? (
          <div className="sn-empty">Aucun utilisateur trouvé</div>
        ) : (
          <table className="sn-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Rôle</th>
                <th>Périmètre</th>
                <th>Dernière connexion</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium text-gray-900">{u.fullName}</div>
                    <div className="text-xs text-gray-400">{u.email}</div>
                  </td>
                  <td>
                    <span className={ROLE_BADGE[u.role] ?? 'sn-badge-gray'}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="text-xs text-gray-500">
                    {u.geographicScopePcodes.length > 0
                      ? u.geographicScopePcodes.join(', ')
                      : <span className="text-gray-300">National</span>
                    }
                  </td>
                  <td className="text-xs text-gray-500 whitespace-nowrap">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'
                    }
                  </td>
                  <td>
                    <span className={`sn-pill-${u.isActive ? 'green' : 'gray'} inline-flex items-center gap-1.5`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {u.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(u)} className="sn-btn-link-blue">
                        Modifier
                      </button>
                      {u.id !== me?.sub && (
                        <button
                          onClick={() => { if (confirm(`Supprimer ${u.email} ?`)) deleteMutation.mutate(u.id) }}
                          className="sn-btn-link-danger"
                        >
                          Supprimer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="sn-pagination">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="sn-page-btn">←</button>
          <span className="text-sm text-gray-600 px-2">{page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="sn-page-btn">→</button>
        </div>
      )}

      {/* Modal — Créer */}
      {showCreate && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h2 className="sn-modal-title">Nouvel utilisateur</h2>
              <button className="sn-modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={createForm.handleSubmit(data => createMutation.mutate(data))} className="space-y-3">
              {([
                { name: 'email',    label: 'Email',        type: 'email' },
                { name: 'fullName', label: 'Nom complet',  type: 'text' },
                { name: 'password', label: 'Mot de passe', type: 'password' },
                { name: 'phone',    label: 'Téléphone',    type: 'tel' },
              ] as const).map(f => (
                <div key={f.name}>
                  <label className="sn-label">{f.label}</label>
                  <input {...createForm.register(f.name)} type={f.type} className="sn-input" />
                  {createForm.formState.errors[f.name] && (
                    <p className="sn-field-error">{createForm.formState.errors[f.name]?.message as string}</p>
                  )}
                </div>
              ))}
              <div>
                <label className="sn-label">Rôle</label>
                <select {...createForm.register('role')} className="sn-select">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="sn-label">Périmètre géographique (P-codes, séparés par virgule)</label>
                <input
                  {...createForm.register('geographicScopePcodes')}
                  placeholder="CD-NK, CD-SK"
                  className="sn-input"
                />
              </div>
              {createMutation.isError && (
                <p className="sn-field-error">
                  {(createMutation.error as any)?.response?.data?.error?.message ?? 'Erreur inconnue'}
                </p>
              )}
              <div className="sn-modal-actions">
                <button type="button" onClick={() => setShowCreate(false)} className="sn-btn-secondary flex-1">
                  Annuler
                </button>
                <button type="submit" disabled={createMutation.isPending} className="sn-btn-primary flex-1">
                  {createMutation.isPending ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Modifier */}
      {editing && (
        <div className="sn-modal-backdrop">
          <div className="sn-modal">
            <div className="sn-modal-header">
              <h2 className="sn-modal-title">Modifier — {editing.email}</h2>
              <button className="sn-modal-close" onClick={() => setEditing(null)}>✕</button>
            </div>
            <form onSubmit={editForm.handleSubmit(data => updateMutation.mutate({ id: editing.id, body: data }))} className="space-y-3">
              <div>
                <label className="sn-label">Rôle</label>
                <select {...editForm.register('role')} className="sn-select">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="sn-label">Périmètre géographique (P-codes)</label>
                <input {...editForm.register('geographicScopePcodes')} placeholder="CD-NK, CD-SK" className="sn-input" />
              </div>
              <div className="flex items-center gap-3 py-1">
                <input type="checkbox" id="isActive" {...editForm.register('isActive')} className="rounded" />
                <label htmlFor="isActive" className="text-sm text-gray-700">Compte actif</label>
              </div>
              {updateMutation.isError && (
                <p className="sn-field-error">
                  {(updateMutation.error as any)?.response?.data?.error?.message ?? 'Erreur'}
                </p>
              )}
              <div className="sn-modal-actions">
                <button type="button" onClick={() => setEditing(null)} className="sn-btn-secondary flex-1">
                  Annuler
                </button>
                <button type="submit" disabled={updateMutation.isPending} className="sn-btn-primary flex-1">
                  {updateMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
