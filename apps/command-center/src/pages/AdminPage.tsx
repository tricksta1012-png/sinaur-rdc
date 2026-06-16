import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

// ── Constantes ───────────────────────────────────────────────────────────────

const PROVINCE_NAMES: Record<string, string> = {
  CD10: 'Kinshasa',      CD20: 'Kongo-Central',  CD21: 'Kwango',        CD22: 'Kwilu',
  CD23: 'Maï-Ndombe',   CD41: 'Équateur',        CD42: 'Sud-Ubangi',    CD43: 'Nord-Ubangi',
  CD44: 'Mongala',       CD45: 'Tshuapa',         CD51: 'Tshopo',        CD52: 'Bas-Uélé',
  CD53: 'Haut-Uélé',    CD54: 'Ituri',           CD61: 'Nord-Kivu',     CD62: 'Sud-Kivu',
  CD63: 'Maniema',       CD71: 'Haut-Katanga',    CD72: 'Lualaba',       CD73: 'Haut-Lomami',
  CD74: 'Tanganyika',    CD81: 'Lomami',          CD82: 'Kasaï-Oriental',CD83: 'Kasaï',
  CD84: 'Kasaï-Central', CD85: 'Sankuru',
};

const PROVINCES_DRC = Object.entries(PROVINCE_NAMES).map(([pcode, name]) => ({ pcode, name }));

const ROLES = [
  { value: 'system_admin',            label: 'Admin Système',     color: 'bg-red-900/70 text-red-300 border-red-800' },
  { value: 'national_decision_maker', label: 'Décideur National', color: 'bg-purple-900/70 text-purple-300 border-purple-800' },
  { value: 'provincial_coordinator',  label: 'Coord. Provincial', color: 'bg-blue-900/70 text-blue-300 border-blue-800' },
  { value: 'territory_admin',         label: 'Admin Territorial', color: 'bg-orange-900/70 text-orange-300 border-orange-800' },
  { value: 'humanitarian_partner',    label: 'Partenaire Hum.',   color: 'bg-green-900/70 text-green-300 border-green-800' },
  { value: 'field_agent',             label: 'Agent Terrain',     color: 'bg-yellow-900/70 text-yellow-300 border-yellow-800' },
  { value: 'local_validator',         label: 'Validateur Local',  color: 'bg-gray-700 text-gray-300 border-gray-600' },
  { value: 'citizen',                 label: 'Citoyen',           color: 'bg-gray-800 text-gray-400 border-gray-700' },
];

const ACTION_COLORS: Record<string, string> = {
  USER_CREATED:   'text-green-400 bg-green-900/30',
  USER_UPDATED:   'text-blue-400 bg-blue-900/30',
  USER_DELETED:   'text-red-400 bg-red-900/30',
  PASSWORD_RESET: 'text-yellow-400 bg-yellow-900/30',
  create:         'text-green-400 bg-green-900/30',
  update:         'text-blue-400 bg-blue-900/30',
};

function roleMeta(role: string) {
  return ROLES.find(r => r.value === role) ?? { label: role, color: 'bg-gray-700 text-gray-400 border-gray-600' };
}

function scopeLabel(pcodes: string[]): string {
  if (!pcodes || pcodes.length === 0) return 'National';
  return pcodes.map(p => PROVINCE_NAMES[p] ?? p).join(', ');
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(date: string | null): string {
  if (!date) return 'Jamais';
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `Il y a ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Il y a ${d}j`;
  return formatDate(date).slice(0, 10);
}

// ── Interfaces ───────────────────────────────────────────────────────────────

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

interface EditForm {
  fullName: string;
  role: string;
  scopePcodes: string[];
  phone: string;
}

interface CreateForm {
  email: string;
  fullName: string;
  password: string;
  role: string;
  scopePcodes: string[];
}

const EMPTY_CREATE: CreateForm = {
  email: '', fullName: '', password: '', role: 'provincial_coordinator', scopePcodes: [],
};

// ── Composants ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const m = roleMeta(role);
  return (
    <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${m.color}`}>
      {m.label}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded border ${
      active ? 'bg-green-900/40 text-green-400 border-green-800' : 'bg-gray-800 text-gray-500 border-gray-700'
    }`}>
      {active ? '● Actif' : '○ Inactif'}
    </span>
  );
}

// ── Page principale ───────────────────────────────────────────────────────────

export function AdminPage() {
  const qc = useQueryClient();

  // Tabs
  const [tab, setTab] = useState<'users' | 'coverage' | 'audit'>('users');

  // Filtres utilisateurs
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'never'>('all');

  // Modales
  const [showCreate, setShowCreate]     = useState(false);
  const [editUser, setEditUser]         = useState<User | null>(null);
  const [showResetPw, setShowResetPw]   = useState(false);
  const [newPassword, setNewPassword]   = useState('');
  const [createErr, setCreateErr]       = useState('');
  const [editErr, setEditErr]           = useState('');
  const [resetErr, setResetErr]         = useState('');
  const [resetOk, setResetOk]           = useState(false);

  // Formulaires
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [editForm, setEditForm]     = useState<EditForm>({ fullName: '', role: '', scopePcodes: [], phone: '' });

  // Audit filters
  const [auditAction, setAuditAction] = useState('');

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['admin-users', roleFilter, search],
    queryFn: () => {
      const p = new URLSearchParams({ limit: '200' });
      if (roleFilter) p.set('role', roleFilter);
      if (search)     p.set('search', search);
      return apiClient.get(`/admin/users?${p}`).then(r => r.data);
    },
    staleTime: 15_000,
  });

  const { data: auditData } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => apiClient.get('/admin/audit-log?limit=100').then(r => r.data),
    enabled: tab === 'audit',
    staleTime: 30_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (b: object) => apiClient.post('/admin/users', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setShowCreate(false); setCreateForm(EMPTY_CREATE); setCreateErr(''); },
    onError: (e: any) => setCreateErr(e?.response?.data?.error?.message ?? 'Erreur.'),
  });

  const editMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => apiClient.patch(`/admin/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); setEditUser(null); setEditErr(''); },
    onError: (e: any) => setEditErr(e?.response?.data?.error?.message ?? 'Erreur.'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiClient.patch(`/admin/users/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const resetPwMut = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiClient.post(`/admin/users/${id}/reset-password`, { password }),
    onSuccess: () => { setResetOk(true); setNewPassword(''); setResetErr(''); setTimeout(() => setResetOk(false), 3000); },
    onError: (e: any) => setResetErr(e?.response?.data?.error?.message ?? 'Erreur.'),
  });

  // ── Données dérivées ───────────────────────────────────────────────────────

  const allUsers: User[] = usersData?.data ?? [];

  const users = useMemo(() => {
    return allUsers.filter(u => {
      if (statusFilter === 'active')   return u.is_active;
      if (statusFilter === 'inactive') return !u.is_active;
      if (statusFilter === 'never')    return !u.last_login_at;
      return true;
    });
  }, [allUsers, statusFilter]);

  const totalActive    = allUsers.filter(u => u.is_active).length;
  const totalInactive  = allUsers.filter(u => !u.is_active).length;
  const neverLogged    = allUsers.filter(u => !u.last_login_at).length;
  const coordCount     = allUsers.filter(u => u.role === 'provincial_coordinator' && u.is_active).length;

  // Couverture provinciale
  const coveredPcodes = useMemo(() => {
    const set = new Set<string>();
    allUsers
      .filter(u => u.role === 'provincial_coordinator' && u.is_active)
      .forEach(u => u.geographic_scope_pcodes.forEach(p => set.add(p)));
    return set;
  }, [allUsers]);

  const audit = auditData?.data ?? [];
  const filteredAudit = auditAction
    ? audit.filter((a: any) => a.action === auditAction)
    : audit;
  const auditActions: string[] = Array.from(new Set<string>(audit.map((a: any) => String(a.action)))).sort();

  // ── Helpers ────────────────────────────────────────────────────────────────

  function openEdit(u: User) {
    setEditUser(u);
    setEditForm({ fullName: u.full_name, role: u.role, scopePcodes: [...u.geographic_scope_pcodes], phone: u.phone ?? '' });
    setEditErr('');
    setShowResetPw(false);
    setResetOk(false);
  }

  function toggleProv(pcode: string, form: string[], setForm: (f: any) => void, key: string) {
    setForm((f: any) => ({
      ...f,
      [key]: f[key].includes(pcode) ? f[key].filter((p: string) => p !== pcode) : [...f[key], pcode],
    }));
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">⚙️ Administration</h1>
          <p className="text-sm text-cc-600 mt-0.5">Comptes · Rôles · Périmètres · Audit</p>
        </div>
        <button onClick={() => { setShowCreate(true); setCreateErr(''); }}
          className="cc-btn-primary flex items-center gap-2 text-sm">
          + Nouveau compte
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="cc-card p-4 border-l-4 border-l-blue-600 cursor-pointer hover:bg-cc-800/50"
          onClick={() => setStatusFilter('active')}>
          <div className="text-2xl font-bold font-mono text-white">{totalActive}</div>
          <div className="text-xs text-gray-400 mt-1">Comptes actifs</div>
        </div>
        <div className="cc-card p-4 border-l-4 border-l-gray-600 cursor-pointer hover:bg-cc-800/50"
          onClick={() => setStatusFilter('inactive')}>
          <div className="text-2xl font-bold font-mono text-gray-400">{totalInactive}</div>
          <div className="text-xs text-gray-500 mt-1">Inactifs</div>
        </div>
        <div className="cc-card p-4 border-l-4 border-l-green-600 cursor-pointer hover:bg-cc-800/50"
          onClick={() => { setRoleFilter('provincial_coordinator'); setTab('users'); }}>
          <div className="text-2xl font-bold font-mono text-white">{coordCount}<span className="text-sm text-gray-500">/26</span></div>
          <div className="text-xs text-gray-400 mt-1">Coordinateurs prov.</div>
        </div>
        <div className="cc-card p-4 border-l-4 border-l-orange-600 cursor-pointer hover:bg-cc-800/50"
          onClick={() => setStatusFilter('never')}>
          <div className="text-2xl font-bold font-mono text-orange-400">{neverLogged}</div>
          <div className="text-xs text-gray-400 mt-1">Jamais connectés</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {([
          { key: 'users',    label: `Utilisateurs (${allUsers.length})` },
          { key: 'coverage', label: 'Couverture provinciale' },
          { key: 'audit',    label: 'Journal d\'audit' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setStatusFilter('all'); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-sinaur-700 text-white' : 'bg-cc-800 text-gray-400 hover:bg-cc-700 hover:text-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
        {statusFilter !== 'all' && (
          <button onClick={() => setStatusFilter('all')}
            className="ml-2 px-3 py-1.5 rounded-lg text-xs text-orange-400 bg-orange-900/30 border border-orange-800 hover:bg-orange-900/50">
            ✕ Filtre actif
          </button>
        )}
      </div>

      {/* ── TAB UTILISATEURS ── */}
      {tab === 'users' && (
        <>
          <div className="flex gap-3 mb-4">
            <input type="text" placeholder="Rechercher email ou nom…"
              className="flex-1 bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600 placeholder-cc-600"
              value={search} onChange={e => setSearch(e.target.value)} />
            <select className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none"
              value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="">Tous les rôles</option>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 cc-card animate-pulse" />)}
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
                  {users.map(u => (
                    <tr key={u.id} className={`hover:bg-cc-800/40 transition-colors ${!u.is_active ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-200 text-sm">{u.full_name}</div>
                        <div className="text-[10px] text-cc-600 font-mono mt-0.5">{u.email}</div>
                        {u.phone && <div className="text-[10px] text-cc-700 font-mono">{u.phone}</div>}
                      </td>
                      <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-cc-600 font-mono">
                          {u.geographic_scope_pcodes.length === 0
                            ? <span className="text-cc-700">🌍 National</span>
                            : scopeLabel(u.geographic_scope_pcodes)
                          }
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className={`text-xs font-mono ${!u.last_login_at ? 'text-orange-500' : 'text-cc-600'}`}
                          title={u.last_login_at ? formatDate(u.last_login_at) : undefined}>
                          {timeAgo(u.last_login_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center"><StatusBadge active={u.is_active} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(u)}
                            className="text-[10px] px-2.5 py-1 rounded bg-sinaur-800/60 text-sinaur-300 hover:bg-sinaur-700 transition-colors">
                            Modifier
                          </button>
                          <button
                            onClick={() => toggleMut.mutate({ id: u.id, isActive: !u.is_active })}
                            disabled={toggleMut.isPending}
                            className={`text-[10px] px-2 py-1 rounded transition-colors ${
                              u.is_active
                                ? 'bg-yellow-900/40 text-yellow-400 hover:bg-yellow-900/70'
                                : 'bg-green-900/40 text-green-400 hover:bg-green-900/70'
                            }`}>
                            {u.is_active ? 'Désactiver' : 'Réactiver'}
                          </button>
                          <button
                            onClick={() => { if (confirm(`Supprimer définitivement ${u.email} ?`)) deleteMut.mutate(u.id); }}
                            className="text-[10px] px-2 py-1 rounded bg-red-900/30 text-red-500 hover:bg-red-900/60 transition-colors">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div className="text-center text-cc-600 text-sm py-12">Aucun utilisateur trouvé</div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── TAB COUVERTURE ── */}
      {tab === 'coverage' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-xs text-cc-600 font-mono">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-800 border border-green-600 inline-block" /> Coordinateur assigné</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-950 border border-red-800 inline-block" /> Province sans coordinateur</span>
            <span className="ml-auto font-bold text-white">{coveredPcodes.size}/26 provinces couvertes</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {PROVINCES_DRC.map(p => {
              const covered = coveredPcodes.has(p.pcode);
              const coord = allUsers.find(
                u => u.role === 'provincial_coordinator' && u.is_active && u.geographic_scope_pcodes.includes(p.pcode)
              );
              return (
                <div key={p.pcode}
                  className={`cc-card p-3 border ${covered ? 'border-green-800/60 bg-green-950/30' : 'border-red-900/40 bg-red-950/20'}`}>
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-xs font-bold text-gray-200">{p.name}</span>
                    <span className="text-[10px] font-mono text-cc-600">{p.pcode}</span>
                  </div>
                  {covered && coord ? (
                    <>
                      <div className="text-[10px] text-green-400 font-mono truncate">{coord.email}</div>
                      <div className={`mt-1 text-[10px] font-mono ${!coord.last_login_at ? 'text-orange-500' : 'text-cc-600'}`}>
                        {timeAgo(coord.last_login_at)}
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] text-red-500 font-mono mt-1">Aucun coordinateur</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB AUDIT ── */}
      {tab === 'audit' && (
        <>
          <div className="flex gap-3 mb-4">
            <select className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none font-mono"
              value={auditAction} onChange={e => setAuditAction(e.target.value)}>
              <option value="">Toutes les actions</option>
              {auditActions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-xs text-cc-600 self-center">{filteredAudit.length} entrées</span>
          </div>
          <div className="cc-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-cc-700">
                <tr className="text-[10px] text-cc-600 font-mono uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Ressource</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Par</th>
                  <th className="text-left px-4 py-3 hidden xl:table-cell">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cc-800">
                {filteredAudit.map((a: any) => {
                  const actionColor = ACTION_COLORS[a.action] ?? 'text-gray-400 bg-cc-800';
                  return (
                    <tr key={a.id} className="hover:bg-cc-800/50">
                      <td className="px-4 py-2 text-[10px] font-mono text-cc-600 whitespace-nowrap">
                        {formatDate(a.created_at)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${actionColor}`}>
                          {a.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 hidden md:table-cell text-[10px] text-cc-600 font-mono">
                        {a.resource}{a.resource_id ? ` #${a.resource_id.slice(0, 8)}` : ''}
                      </td>
                      <td className="px-4 py-2 hidden lg:table-cell text-xs text-gray-400">
                        <div>{a.user_name ?? a.user_email ?? '—'}</div>
                        <div className="text-[10px] text-cc-700 font-mono">{a.user_role ?? ''}</div>
                      </td>
                      <td className="px-4 py-2 hidden xl:table-cell text-[10px] font-mono text-cc-600">
                        {a.ip_address ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredAudit.length === 0 && (
              <div className="text-center text-cc-600 text-sm py-12">Aucun événement</div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL CRÉATION
      ═══════════════════════════════════════════════════════════════════ */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700">
              <h2 className="text-white font-semibold">Créer un compte</h2>
              <button onClick={() => { setShowCreate(false); setCreateErr(''); }} className="text-cc-600 hover:text-gray-300 text-xl">×</button>
            </div>
            <form onSubmit={e => { e.preventDefault(); setCreateErr(''); createMut.mutate({ email: createForm.email, fullName: createForm.fullName, password: createForm.password, role: createForm.role, geographicScopePcodes: createForm.scopePcodes }); }}
              className="px-6 py-5 space-y-3 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="adm-label">Email *</label>
                <input className="adm-input" type="email" required value={createForm.email}
                  onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="nom@organisation.cd" />
              </div>
              <div>
                <label className="adm-label">Nom complet *</label>
                <input className="adm-input" required value={createForm.fullName}
                  onChange={e => setCreateForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Prénom Nom" />
              </div>
              <div>
                <label className="adm-label">Mot de passe * (min. 10 caractères)</label>
                <input className="adm-input font-mono" type="password" required minLength={10}
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••••" />
              </div>
              <div>
                <label className="adm-label">Rôle *</label>
                <select className="adm-input" value={createForm.role}
                  onChange={e => setCreateForm(f => ({ ...f, role: e.target.value, scopePcodes: [] }))}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="adm-label">
                  Périmètre géographique
                  {createForm.scopePcodes.length > 0 && <span className="ml-2 text-blue-400">({createForm.scopePcodes.length} province{createForm.scopePcodes.length > 1 ? 's' : ''})</span>}
                </label>
                <p className="text-[10px] text-cc-600 mb-2">Vide = accès national.</p>
                <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto bg-cc-800 rounded-lg p-2 border border-cc-700">
                  {PROVINCES_DRC.map(p => (
                    <label key={p.pcode} className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-white py-0.5">
                      <input type="checkbox" className="accent-sinaur-500"
                        checked={createForm.scopePcodes.includes(p.pcode)}
                        onChange={() => toggleProv(p.pcode, createForm.scopePcodes, setCreateForm, 'scopePcodes')} />
                      <span>{p.name}</span>
                      <span className="text-cc-600 font-mono text-[10px]">{p.pcode}</span>
                    </label>
                  ))}
                </div>
              </div>
              {createErr && <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">{createErr}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => { setShowCreate(false); setCreateErr(''); }} className="cc-btn-ghost">Annuler</button>
                <button type="submit" disabled={createMut.isPending} className="cc-btn-primary">
                  {createMut.isPending ? 'Création…' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          PANNEAU ÉDITION (slide-over)
      ═══════════════════════════════════════════════════════════════════ */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setEditUser(null)} />
          <div className="w-full max-w-md bg-cc-900 border-l border-cc-700 flex flex-col h-full overflow-y-auto shadow-2xl">

            {/* Header édition */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-cc-700 shrink-0">
              <div>
                <h2 className="text-white font-semibold text-base">{editUser.full_name}</h2>
                <div className="text-[11px] text-cc-600 font-mono mt-0.5">{editUser.email}</div>
              </div>
              <button onClick={() => setEditUser(null)} className="text-cc-600 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="flex-1 px-6 py-5 space-y-5 overflow-y-auto">

              {/* Statut actuel */}
              <div className="flex items-center gap-3">
                <RoleBadge role={editUser.role} />
                <StatusBadge active={editUser.is_active} />
                <span className="text-[10px] text-cc-600 font-mono ml-auto">
                  Connexion : {timeAgo(editUser.last_login_at)}
                </span>
              </div>

              {/* Formulaire édition */}
              <form onSubmit={e => { e.preventDefault(); editMut.mutate({ id: editUser.id, body: { fullName: editForm.fullName, role: editForm.role, geographicScopePcodes: editForm.scopePcodes, phone: editForm.phone || undefined } }); }}
                className="space-y-3">
                <div>
                  <label className="adm-label">Nom complet</label>
                  <input className="adm-input" value={editForm.fullName}
                    onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} />
                </div>
                <div>
                  <label className="adm-label">Téléphone</label>
                  <input className="adm-input" value={editForm.phone}
                    onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+243 …" />
                </div>
                <div>
                  <label className="adm-label">Rôle</label>
                  <select className="adm-input" value={editForm.role}
                    onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="adm-label">
                    Périmètre géographique
                    {editForm.scopePcodes.length > 0 && <span className="ml-2 text-blue-400">({editForm.scopePcodes.length} province{editForm.scopePcodes.length > 1 ? 's' : ''})</span>}
                  </label>
                  <div className="grid grid-cols-2 gap-1 max-h-44 overflow-y-auto bg-cc-800 rounded-lg p-2 border border-cc-700">
                    {PROVINCES_DRC.map(p => (
                      <label key={p.pcode} className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-white py-0.5">
                        <input type="checkbox" className="accent-sinaur-500"
                          checked={editForm.scopePcodes.includes(p.pcode)}
                          onChange={() => setEditForm(f => ({
                            ...f,
                            scopePcodes: f.scopePcodes.includes(p.pcode)
                              ? f.scopePcodes.filter(x => x !== p.pcode)
                              : [...f.scopePcodes, p.pcode],
                          }))} />
                        <span>{p.name}</span>
                        <span className="text-cc-600 font-mono text-[10px]">{p.pcode}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {editErr && <div className="text-red-400 text-xs bg-red-950 px-3 py-2 rounded-lg">{editErr}</div>}
                <button type="submit" disabled={editMut.isPending} className="w-full cc-btn-primary">
                  {editMut.isPending ? 'Enregistrement…' : '✓ Enregistrer les modifications'}
                </button>
              </form>

              {/* Séparateur */}
              <div className="border-t border-cc-700" />

              {/* Réinitialisation mot de passe */}
              <div>
                <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-3">
                  Réinitialisation du mot de passe
                </div>
                {!showResetPw ? (
                  <button onClick={() => setShowResetPw(true)}
                    className="w-full text-sm py-2 rounded-lg bg-yellow-900/30 text-yellow-400 border border-yellow-800 hover:bg-yellow-900/50 transition-colors">
                    🔑 Définir un nouveau mot de passe
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input className="adm-input font-mono" type="password" minLength={10}
                      placeholder="Nouveau mot de passe (min. 10 car.)"
                      value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                    {resetErr && <div className="text-red-400 text-xs">{resetErr}</div>}
                    {resetOk  && <div className="text-green-400 text-xs">✓ Mot de passe mis à jour.</div>}
                    <div className="flex gap-2">
                      <button onClick={() => setShowResetPw(false)} className="flex-1 cc-btn-ghost text-xs py-1.5">Annuler</button>
                      <button
                        disabled={newPassword.length < 10 || resetPwMut.isPending}
                        onClick={() => resetPwMut.mutate({ id: editUser.id, password: newPassword })}
                        className="flex-1 bg-yellow-700 hover:bg-yellow-600 text-white text-xs py-1.5 rounded-lg disabled:opacity-50">
                        {resetPwMut.isPending ? 'Mise à jour…' : 'Confirmer'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Séparateur */}
              <div className="border-t border-cc-700" />

              {/* Zone danger */}
              <div>
                <div className="text-xs font-mono text-cc-500 uppercase tracking-wider mb-3">Zone de danger</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleMut.mutate({ id: editUser.id, isActive: !editUser.is_active })}
                    className={`flex-1 text-xs py-2 rounded-lg border transition-colors ${
                      editUser.is_active
                        ? 'bg-yellow-900/30 text-yellow-400 border-yellow-800 hover:bg-yellow-900/50'
                        : 'bg-green-900/30 text-green-400 border-green-800 hover:bg-green-900/50'
                    }`}>
                    {editUser.is_active ? 'Désactiver le compte' : 'Réactiver le compte'}
                  </button>
                  <button
                    onClick={() => { if (confirm(`Supprimer définitivement ${editUser.email} ?`)) { deleteMut.mutate(editUser.id); setEditUser(null); } }}
                    className="flex-1 text-xs py-2 rounded-lg bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/60 transition-colors">
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .adm-label { display:block; font-size:.68rem; color:#475569; font-family:monospace; text-transform:uppercase; letter-spacing:.06em; margin-bottom:.2rem; }
        .adm-input { width:100%; background:#1e293b; border:1px solid #334155; border-radius:.5rem; padding:.45rem .75rem; font-size:.875rem; color:#f1f5f9; outline:none; }
        .adm-input:focus { border-color:#7c3aed; }
        .adm-input::placeholder { color:#475569; }
      `}</style>
    </div>
  );
}
