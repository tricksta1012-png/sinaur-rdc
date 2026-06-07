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

const ROLE_COLORS: Record<Role, string> = {
  citizen:                 'bg-gray-100 text-gray-700',
  field_agent:             'bg-blue-100 text-blue-700',
  local_validator:         'bg-teal-100 text-teal-700',
  territory_admin:         'bg-purple-100 text-purple-700',
  humanitarian_partner:    'bg-orange-100 text-orange-700',
  national_decision_maker: 'bg-red-100 text-red-700',
  system_admin:            'bg-red-200 text-red-900 font-bold',
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
  const [search, setSearch]       = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage]           = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing]     = useState<User | null>(null)

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

  const users = data?.data ?? []
  const meta  = data?.meta
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestion des utilisateurs</h1>
          <p className="text-sm text-gray-500 mt-1">
            {meta?.total ?? '—'} utilisateur{(meta?.total ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
        >
          + Nouvel utilisateur
        </button>
      </div>

      {/* Filtres */}
      <div className="flex gap-3 flex-wrap">
        <input
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:ring-2 focus:ring-red-500 focus:border-transparent"
          placeholder="Rechercher par nom ou email…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
          value={roleFilter}
          onChange={e => { setRoleFilter(e.target.value); setPage(1) }}
        >
          <option value="">Tous les rôles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-gray-400">Chargement…</div>
        ) : users.length === 0 ? (
          <div className="py-20 text-center text-gray-400">Aucun utilisateur trouvé</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Utilisateur', 'Rôle', 'Périmètre', 'Dernière connexion', 'Statut', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{u.fullName}</div>
                    <div className="text-gray-500 text-xs">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-700'}`}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.geographicScopePcodes.length > 0
                      ? u.geographicScopePcodes.join(', ')
                      : <span className="text-gray-300">National</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {u.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Modifier
                      </button>
                      {u.id !== me?.sub && (
                        <button
                          onClick={() => { if (confirm(`Supprimer ${u.email} ?`)) deleteMutation.mutate(u.id) }}
                          className="text-xs text-red-500 hover:text-red-700 font-medium"
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">←</button>
          <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm border rounded-lg disabled:opacity-40 hover:bg-gray-50">→</button>
        </div>
      )}

      {/* Modal — Créer */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Nouvel utilisateur</h2>
            <form onSubmit={createForm.handleSubmit(data => createMutation.mutate(data))} className="space-y-3">
              {([
                { name: 'email',    label: 'Email',          type: 'email' },
                { name: 'fullName', label: 'Nom complet',    type: 'text' },
                { name: 'password', label: 'Mot de passe',   type: 'password' },
                { name: 'phone',    label: 'Téléphone',      type: 'tel' },
              ] as const).map(f => (
                <div key={f.name}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</label>
                  <input
                    {...createForm.register(f.name)}
                    type={f.type}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
                  />
                  {createForm.formState.errors[f.name] && (
                    <p className="text-red-500 text-xs mt-1">{createForm.formState.errors[f.name]?.message as string}</p>
                  )}
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Rôle</label>
                <select {...createForm.register('role')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Périmètre (P-codes, séparés par virgule)</label>
                <input
                  {...createForm.register('geographicScopePcodes')}
                  placeholder="CD-NK, CD-SK"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              {createMutation.isError && (
                <p className="text-red-600 text-xs">Erreur : {(createMutation.error as any)?.response?.data?.error?.message ?? 'Inconnu'}</p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Annuler</button>
                <button type="submit" disabled={createMutation.isPending}
                  className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60">
                  {createMutation.isPending ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal — Modifier */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Modifier — {editing.email}</h2>
            <form onSubmit={editForm.handleSubmit(data => updateMutation.mutate({ id: editing.id, body: data }))} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Rôle</label>
                <select {...editForm.register('role')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Périmètre (P-codes)</label>
                <input {...editForm.register('geographicScopePcodes')}
                  placeholder="CD-NK, CD-SK"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="isActive" {...editForm.register('isActive')} className="rounded" />
                <label htmlFor="isActive" className="text-sm text-gray-700">Compte actif</label>
              </div>
              {updateMutation.isError && (
                <p className="text-red-600 text-xs">{(updateMutation.error as any)?.response?.data?.error?.message ?? 'Erreur'}</p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditing(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Annuler</button>
                <button type="submit" disabled={updateMutation.isPending}
                  className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-60">
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
