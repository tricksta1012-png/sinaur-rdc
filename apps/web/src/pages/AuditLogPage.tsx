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

const ACTION_BADGE: Record<string, string> = {
  USER_CREATED:     'sn-badge-green',
  USER_UPDATED:     'sn-badge-blue',
  USER_DELETED:     'sn-badge-red',
  LOGIN:            'sn-badge-gray',
  LOGIN_FAILED:     'sn-badge-orange',
  LOGOUT:           'sn-badge-gray',
  EVENT_CREATED:    'sn-badge-purple',
  EVENT_UPDATED:    'sn-badge-purple',
  ALERT_DISPATCHED: 'sn-badge-yellow',
  REGISTRY_CREATED: 'sn-badge-teal',
  AID_VALIDATED:    'sn-badge-teal',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
}

export function AuditLogPage() {
  const today = new Date().toISOString().split('T')[0] ?? ''
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] ?? ''

  const [page, setPage]         = useState(1)
  const [from, setFrom]         = useState(sevenDaysAgo)
  const [to, setTo]             = useState(today)
  const [userId, setUserId]     = useState('')
  const [action, setAction]     = useState('')
  const [resource, setResource] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

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

  const entries    = data?.data ?? []
  const meta       = data?.meta
  const filters    = data?.filters
  const totalPages = meta ? Math.ceil(meta.total / meta.limit) : 1

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
    <div className="sn-page">
      <div className="sn-page-header">
        <div>
          <h1 className="sn-page-title">Journal d'audit</h1>
          <p className="sn-page-subtitle">{meta?.total ?? '—'} entrée{(meta?.total ?? 0) !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={entries.length === 0}
          className="sn-btn-dark"
        >
          ↓ Exporter CSV
        </button>
      </div>

      {/* Filtres */}
      <div className="sn-card sn-card-body">
        <div className="sn-filter-bar">
          <div>
            <label className="sn-label">Du</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="sn-input w-40" />
          </div>
          <div>
            <label className="sn-label">Au</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="sn-input w-40" />
          </div>
          <div>
            <label className="sn-label">Action</label>
            <select value={action} onChange={e => setAction(e.target.value)} className="sn-select w-44">
              <option value="">Toutes</option>
              {filters?.actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="sn-label">Ressource</label>
            <select value={resource} onChange={e => setResource(e.target.value)} className="sn-select w-44">
              <option value="">Toutes</option>
              {filters?.resources.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="sn-label">Utilisateur (email ou ID)</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="Filtrer par utilisateur…"
              className="sn-input"
            />
          </div>
          <button onClick={() => setPage(1)} className="sn-btn-primary">
            Appliquer
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="sn-table-wrap">
        {isLoading ? (
          <div className="sn-empty">Chargement…</div>
        ) : entries.length === 0 ? (
          <div className="sn-empty">Aucune entrée trouvée</div>
        ) : (
          <table className="sn-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>Ressource</th>
                <th>IP</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <>
                  <tr
                    key={e.id}
                    className="cursor-pointer"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    <td className="text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(e.created_at)}
                    </td>
                    <td>
                      <div className="font-medium text-gray-900 text-xs">{e.user_name ?? '—'}</div>
                      <div className="text-gray-400 text-xs">{e.user_email ?? 'Système'}</div>
                    </td>
                    <td>
                      <span className={ACTION_BADGE[e.action] ?? 'sn-badge-gray'}>
                        {e.action}
                      </span>
                    </td>
                    <td className="text-xs">
                      <span className="font-medium text-gray-700">{e.resource}</span>
                      {e.resource_id && (
                        <span className="block text-gray-400 font-mono">{e.resource_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400 font-mono">{e.ip_address ?? '—'}</td>
                    <td className="text-xs">
                      {e.details
                        ? <span className="sn-btn-link-blue">{expanded === e.id ? 'Masquer ▲' : 'Voir ▼'}</span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                  </tr>
                  {expanded === e.id && e.details && (
                    <tr key={`${e.id}-detail`} className="!bg-gray-50">
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

      {totalPages > 1 && (
        <div className="sn-pagination">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="sn-page-btn">←</button>
          <span className="text-sm text-gray-600 px-2">{page} / {totalPages}</span>
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="sn-page-btn">→</button>
        </div>
      )}
    </div>
  )
}
