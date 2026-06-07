import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api.js'

interface AuditEntry {
  id: string
  created_at: string
  action: string
  resource: string
  resource_id: string | null
  ip_address: string | null
  user_agent: string | null
  details: Record<string, unknown> | null
  user_email: string | null
  user_name: string | null
  user_role: string | null
}

interface AuditResponse {
  data: AuditEntry[]
  meta: { total: number; page: number; limit: number }
  filters: { actions: string[]; resources: string[] }
}

const ACTION_COLORS: Record<string, string> = {
  USER_CREATED:        'bg-green-100 text-green-700',
  USER_UPDATED:        'bg-blue-100 text-blue-700',
  USER_DELETED:        'bg-red-100 text-red-700',
  LOGIN:               'bg-gray-100 text-gray-600',
  LOGIN_FAILED:        'bg-orange-100 text-orange-700',
  LOGOUT:              'bg-gray-100 text-gray-500',
  EVENT_CREATED:       'bg-purple-100 text-purple-700',
  EVENT_UPDATED:       'bg-purple-50 text-purple-600',
  ALERT_DISPATCHED:    'bg-yellow-100 text-yellow-700',
  REGISTRY_CREATED:    'bg-teal-100 text-teal-700',
  AID_VALIDATED:       'bg-teal-100 text-teal-600',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

export function AuditLogPage() {
  const today = new Date().toISOString().split('T')[0]
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

  const [page, setPage]           = useState(1)
  const [from, setFrom]           = useState(sevenDaysAgo)
  const [to, setTo]               = useState(today)
  const [userId, setUserId]       = useState('')
  const [action, setAction]       = useState('')
  const [resource, setResource]   = useState('')
  const [expanded, setExpanded]   = useState<string | null>(null)

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ['audit-log', page, from, to, userId, action, resource],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '50', from, to })
      if (userId)   params.set('userId', userId)
      if (action)   params.set('action', action)
      if (resource) params.set('resource', resource)
      const { data } = await apiClient.get<AuditResponse>(`/admin/audit-log?${params}`)
      return data
    },
  })

  const entries     = data?.data ?? []
  const meta        = data?.meta
  const filters     = data?.filters
  const totalPages  = meta ? Math.ceil(meta.total / meta.limit) : 1

  const applyFilter = () => setPage(1)

  const exportCsv = () => {
    const header = ['Date', 'Utilisateur', 'Rôle', 'Action', 'Ressource', 'ID ressource', 'IP', 'Détails']
    const rows = entries.map(e => [
      formatDate(e.created_at),
      e.user_email ?? '',
      e.user_role ?? '',
      e.action,
      e.resource,
      e.resource_id ?? '',
      e.ip_address ?? '',
      e.details ? JSON.stringify(e.details) : '',
    ])
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal d'audit</h1>
          <p className="text-sm text-gray-500 mt-1">
            {meta?.total ?? '—'} entrée{(meta?.total ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={entries.length === 0}
          className="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
        >
          Exporter CSV
        </button>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Du</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Au</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Action</label>
            <select
              value={action}
              onChange={e => setAction(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
            >
              <option value="">Toutes</option>
              {filters?.actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Ressource</label>
            <select
              value={resource}
              onChange={e => setResource(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
            >
              <option value="">Toutes</option>
              {filters?.resources.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Utilisateur (email ou ID)</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="Filtrer par utilisateur…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500"
            />
          </div>
          <button
            onClick={applyFilter}
            className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            Appliquer
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center text-gray-400">Chargement…</div>
        ) : entries.length === 0 ? (
          <div className="py-20 text-center text-gray-400">Aucune entrée trouvée</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Date', 'Utilisateur', 'Action', 'Ressource', 'IP', 'Détails'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map(e => (
                <>
                  <tr
                    key={e.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(e.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 text-xs">{e.user_name ?? '—'}</div>
                      <div className="text-gray-400 text-xs">{e.user_email ?? 'Système'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[e.action] ?? 'bg-gray-100 text-gray-600'}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{e.resource}</span>
                      {e.resource_id && (
                        <span className="block text-gray-400 font-mono text-xs">{e.resource_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{e.ip_address ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {e.details
                        ? <span className="text-blue-600 hover:text-blue-800">{expanded === e.id ? 'Masquer ▲' : 'Voir ▼'}</span>
                        : '—'
                      }
                    </td>
                  </tr>
                  {expanded === e.id && e.details && (
                    <tr key={`${e.id}-detail`} className="bg-gray-50">
                      <td colSpan={6} className="px-6 py-3">
                        <pre className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto">
                          {JSON.stringify(e.details, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
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
    </div>
  )
}
