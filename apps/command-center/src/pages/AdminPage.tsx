import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa', CD20: 'Kongo-Central', CD21: 'Kwango', CD22: 'Kwilu',
  CD23: 'Maï-Ndombe', CD41: 'Équateur', CD42: 'Sud-Ubangi', CD43: 'Nord-Ubangi',
  CD44: 'Mongala', CD45: 'Tshuapa', CD51: 'Tshopo', CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé', CD54: 'Ituri', CD61: 'Nord-Kivu', CD62: 'Sud-Kivu',
  CD63: 'Maniema', CD71: 'Haut-Katanga', CD72: 'Lualaba', CD73: 'Haut-Lomami',
  CD74: 'Tanganyika', CD81: 'Lomami', CD82: 'Kasaï-Oriental', CD83: 'Kasaï',
  CD84: 'Kasaï-Central', CD85: 'Sankuru',
};

const PROVINCES_DRC = Object.entries(PROVINCE_NAMES).map(([pcode, name]) => ({ pcode, name }));

const ROLES = [
  { value: 'system_admin',            label: 'Admin Système',       color: 'bg-red-900 text-red-300' },
  { value: 'national_decision_maker', label: 'Décideur National',   color: 'bg-purple-900 text-purple-300' },
  { value: 'provincial_coordinator',  label: 'Coord. Provincial',   color: 'bg-blue-900 text-blue-300' },
  { value: 'territory_admin',         label: 'Admin Territorial',   color: 'bg-orange-900 text-orange-300' },
  { value: 'humanitarian_partner',    label: 'Partenaire Hum.',     color: 'bg-green-900 text-green-300' },
  { value: 'field_agent',             label: 'Agent Terrain',       color: 'bg-yellow-900 text-yellow-300' },
  { value: 'local_validator',         label: 'Validateur Local',    color: 'bg-gray-700 text-gray-300' },
  { value: 'citizen',                 label: 'Citoyen',             color: 'bg-gray-800 text-gray-400' },
];

function roleMeta(role: string) {
  return ROLES.find(r => r.value === role) ?? { label: role, color: 'bg-gray-700 text-gray-400' };
}

function scopeLabel(pcodes: string[]): string {
  if (!pcodes || pcodes.length === 0) return '— National';
  return pcodes.map(p => PROVINCE_NAMES[p] ?? p).join(', ');
}

function timeAgo(date: string | null): string {
  if (!date) return 'Jamais';
  const diff = Date.now() - new Date(date).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Il y a < 1h';
  if (h < 24) return `Il y a ${h}h`;
  return `Il y a ${Math.floor(h / 24)}j`;
}

interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: string;
  geographic_scope_pcodes: string[];
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface CreateForm {
  email: string;
  fullName: string;
  password: string;
  role: string;
  scopePcodes: string[];
}

const EMPTY_FORM: CreateForm = {
  email: '', fullName: '', password: '', role: 'provincial_coordinator', scopePcodes: [],
};

export function AdminPage() {
  const qc = useQueryClient();
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch]         = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState<CreateForm>(EMPTY_FORM);
  const [tab, setTab]               = useState<'users' | 'audit'>('users');
  const [createErr, setCreateErr]   = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', roleFilter, search],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (roleFilter) params.set('role', roleFilter);
      if (search)     params.set('search', search);
      return apiClient.get(`/admin/users?${params}`).then(r => r.data);
    },
    staleTime: 15_000,
  });

  const { data: auditData } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => apiClient.get('/admin/audit-log?limit=50').then(r => r.data),
    enabled: tab === 'audit',
    staleTime: 30_000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (body: object) => apiClient.post('/admin/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setCreateErr('');
    },
    onError: (e: any) => {
      setCreateErr(e?.response?.data?.error?.message ?? 'Erreur lors de la création.');
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch(`/admin/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr('');
    createMutation.mutate({
      email:                 form.email,
      fullName:              form.fullName,
      password:              form.password,
      role:                  form.role,
      geographicScopePcodes: form.scopePcodes,
    });
  }

  function toggleProvince(pcode: string) {
    setForm(f => ({
      ...f,
      scopePcodes: f.scopePcodes.includes(pcode)
        ? f.scopePcodes.filter(p => p !== pcode)
        : [...f.scopePcodes, pcode],
    }));
  }

  const users: User[] = usersData?.data ?? [];
  const audit = auditData?.data ?? [];

  // Résumé rapide
  const totalActive     = users.filter(u => u.is_active).length;
  const coordsProvinces = users.filter(u => u.role === 'provincial_coordinator' && u.is_active).length;
  const admins          = users.filter(u => u.role === 'system_admin').length;

  return (
    <div className="h-full overflow-y-auto p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">⚙️ Administration des utilisateurs</h1>
          <p className="text-sm text-cc-600 mt-0.5">Gestion des comptes, rôles et périmètres géographiques</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreateErr(''); }}
          className="cc-btn-primary flex items-center gap-2"
        >
          + Créer un compte
        </button>
      </div>

      {/* KPIs rapides */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="cc-card p-4 border-l-4 border-l-blue-600">
          <div className="text-2xl font-bold font-mono text-white">{totalActive}</div>
          <div className="text-xs text-gray-400 mt-1">Comptes actifs</div>
        </div>
        <div className="cc-card p-4 border-l-4 border-l-green-600">
          <div className="text-2xl font-bold font-mono text-white">{coordsProvinces}</div>
          <div className="text-xs text-gray-400 mt-1">Coordinateurs provinciaux</div>
        </div>
        <div className="cc-card p-4 border-l-4 border-l-red-600">
          <div className="text-2xl font-bold font-mono text-white">{admins}</div>
          <div className="text-xs text-gray-400 mt-1">Administrateurs</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { key: 'users', label: 'Utilisateurs' },
          { key: 'audit', label: 'Journal d\'audit' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as 'users' | 'audit')}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-sinaur-700 text-white' : 'bg-cc-800 text-gray-400 hover:bg-cc-700 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          {/* Filtres */}
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Rechercher email ou nom…"
              className="flex-1 bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600 placeholder-cc-600"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600"
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
            >
              <option value="">Tous les rôles</option>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 cc-card animate-pulse" />)}
            </div>
          ) : (
            <div className="cc-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-cc-700">
                  <tr className="text-[10px] text-cc-600 font-mono uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Utilisateur</th>
                    <th className="text-left px-4 py-3">Rôle</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Périmètre</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Dernière connexion</th>
                    <th className="text-center px-4 py-3">Statut</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cc-800">
                  {users.map(u => {
                    const rm = roleMeta(u.role);
                    return (
                      <tr key={u.id} className={`hover:bg-cc-800/50 transition-colors ${!u.is_active ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-200 text-sm truncate max-w-[200px]">{u.full_name}</div>
                          <div className="text-[10px] text-cc-600 font-mono truncate">{u.email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${rm.color}`}>
                            {rm.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-cc-600 font-mono">
                            {scopeLabel(u.geographic_scope_pcodes)}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-cc-600 font-mono">{timeAgo(u.last_login_at)}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                            u.is_active
                              ? 'bg-green-900/40 text-green-400 border-green-800'
                              : 'bg-gray-800 text-gray-500 border-gray-700'
                          }`}>
                            {u.is_active ? 'Actif' : 'Inactif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.is_active })}
                              disabled={toggleActive.isPending}
                              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                                u.is_active
                                  ? 'bg-yellow-900/40 text-yellow-400 hover:bg-yellow-900/70'
                                  : 'bg-green-900/40 text-green-400 hover:bg-green-900/70'
                              }`}
                            >
                              {u.is_active ? 'Désactiver' : 'Réactiver'}
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Supprimer ${u.email} ?`)) deleteMutation.mutate(u.id);
                              }}
                              className="text-[10px] px-2 py-1 rounded bg-red-900/40 text-red-400 hover:bg-red-900/70 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="text-center text-cc-600 text-sm py-12">Aucun utilisateur trouvé</div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'audit' && (
        <div className="cc-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-cc-700">
              <tr className="text-[10px] text-cc-600 font-mono uppercase tracking-wider">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Ressource</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Utilisateur</th>
                <th className="text-left px-4 py-3 hidden xl:table-cell">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cc-800">
              {audit.map((a: any) => (
                <tr key={a.id} className="hover:bg-cc-800/50">
                  <td className="px-4 py-2 text-[10px] font-mono text-cc-600 whitespace-nowrap">
                    {new Date(a.created_at).toLocaleString('fr-FR')}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-cc-800 text-yellow-400 rounded">
                      {a.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 hidden md:table-cell text-[10px] text-cc-600 font-mono">
                    {a.resource}{a.resource_id ? ` #${a.resource_id.slice(0, 8)}` : ''}
                  </td>
                  <td className="px-4 py-2 hidden lg:table-cell text-xs text-gray-400">
                    {a.user_email ?? '—'}
                  </td>
                  <td className="px-4 py-2 hidden xl:table-cell text-[10px] font-mono text-cc-600">
                    {a.ip_address ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && (
            <div className="text-center text-cc-600 text-sm py-12">Aucun événement d'audit</div>
          )}
        </div>
      )}

      {/* Modal création */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700">
              <h2 className="text-white font-semibold">Créer un compte</h2>
              <button onClick={() => { setShowCreate(false); setCreateErr(''); }} className="text-cc-600 hover:text-gray-300 text-xl">×</button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4 max-h-[80vh] overflow-y-auto">

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="adm-label">Email *</label>
                  <input className="adm-input" type="email" required value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="nom@organisation.cd" />
                </div>
                <div className="col-span-2">
                  <label className="adm-label">Nom complet *</label>
                  <input className="adm-input" required value={form.fullName}
                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder="Prénom Nom" />
                </div>
                <div className="col-span-2">
                  <label className="adm-label">Mot de passe * (min. 10 caractères)</label>
                  <input className="adm-input font-mono" type="password" required minLength={10}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••••" />
                </div>
                <div className="col-span-2">
                  <label className="adm-label">Rôle *</label>
                  <select className="adm-input" value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value, scopePcodes: [] }))}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Périmètre géographique */}
              <div>
                <label className="adm-label">
                  Périmètre géographique
                  {form.scopePcodes.length > 0 && (
                    <span className="ml-2 text-blue-400">({form.scopePcodes.length} province{form.scopePcodes.length > 1 ? 's' : ''})</span>
                  )}
                </label>
                <p className="text-[10px] text-cc-600 mb-2">
                  Vide = accès national. Cochez les provinces pour restreindre l'accès.
                </p>
                <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto bg-cc-800 rounded-lg p-2 border border-cc-700">
                  {PROVINCES_DRC.map(p => (
                    <label key={p.pcode} className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-white py-0.5">
                      <input
                        type="checkbox"
                        className="accent-sinaur-500"
                        checked={form.scopePcodes.includes(p.pcode)}
                        onChange={() => toggleProvince(p.pcode)}
                      />
                      <span>{p.name}</span>
                      <span className="text-cc-600 font-mono text-[10px]">{p.pcode}</span>
                    </label>
                  ))}
                </div>
              </div>

              {createErr && (
                <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">{createErr}</div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setShowCreate(false); setCreateErr(''); }} className="cc-btn-ghost">
                  Annuler
                </button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary">
                  {createMutation.isPending ? 'Création…' : 'Créer le compte'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .adm-label { display:block; font-size:.7rem; color:#475569; font-family:monospace; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.25rem; }
        .adm-input { width:100%; background:#1e293b; border:1px solid #334155; border-radius:.5rem; padding:.5rem .75rem; font-size:.875rem; color:#f1f5f9; outline:none; }
        .adm-input:focus { border-color:#7c3aed; }
      `}</style>
    </div>
  );
}
