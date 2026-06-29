import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

const COLUMNS: { key: TaskStatus; label: string; color: string; headerColor: string }[] = [
  { key: 'todo',        label: 'À faire',       color: 'border-gray-600',  headerColor: 'bg-cc-700'    },
  { key: 'in_progress', label: 'En cours',       color: 'border-blue-600',  headerColor: 'bg-blue-900'  },
  { key: 'blocked',     label: 'Bloqué',         color: 'border-red-600',   headerColor: 'bg-red-950'   },
  { key: 'done',        label: 'Terminé',        color: 'border-green-600', headerColor: 'bg-green-950' },
];

const PRIORITY_LABELS = ['Normal', 'Haute', 'Urgente'];
const PRIORITY_COLORS = ['text-gray-400', 'text-yellow-400', 'text-red-400'];

export function CoordinationPage() {
  const qc = useQueryClient();
  const [crisisId, setCrisisId] = useState<string>('');
  const [showNew, setShowNew]   = useState(false);
  const [newTask, setNewTask]   = useState({ title: '', description: '', priority: 0, agency: '', dueDate: '' });

  const { data: crises } = useQuery({
    queryKey: ['crises-all'],
    queryFn: () => apiClient.get('/crises?status=active&limit=50').then(r => r.data.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: tasks } = useQuery({
    queryKey: ['tasks', crisisId],
    queryFn: () => crisisId
      ? apiClient.get(`/crises/${crisisId}/tasks`).then(r => r.data.data)
      : Promise.resolve([]),
    enabled: !!crisisId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      apiClient.patch(`/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', crisisId] }),
  });

  const createMutation = useMutation({
    mutationFn: (body: unknown) => apiClient.post(`/crises/${crisisId}/tasks`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks', crisisId] }); setShowNew(false); setNewTask({ title: '', description: '', priority: 0, agency: '', dueDate: '' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', crisisId] }),
  });

  const tasksByStatus = (status: TaskStatus) =>
    (tasks ?? []).filter((t: any) => t.status === status);

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Coordination inter-agences</h1>
          <p className="text-xs text-cc-600 mt-0.5">Tableau kanban par crise</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="bg-cc-800 border border-cc-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-sinaur-600"
            value={crisisId}
            onChange={e => setCrisisId(e.target.value)}
          >
            <option value="">— Sélectionner une crise —</option>
            {(crises ?? []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.glideNumber} — {c.title}</option>
            ))}
          </select>
          {crisisId && (
            <button onClick={() => setShowNew(true)} className="cc-btn-primary">
              + Tâche
            </button>
          )}
        </div>
      </div>

      {/* Kanban */}
      {!crisisId ? (
        <div className="flex-1 flex items-center justify-center text-cc-600 text-sm">
          Sélectionnez une crise pour afficher ses tâches
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-4 gap-3 overflow-hidden">
          {COLUMNS.map(col => {
            const colTasks = tasksByStatus(col.key);
            return (
              <div key={col.key} className={`flex flex-col cc-card border-t-2 ${col.color} overflow-hidden`}>
                {/* Column header */}
                <div className={`px-3 py-2 ${col.headerColor} shrink-0`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white uppercase tracking-wide">{col.label}</span>
                    <span className="text-xs font-mono text-gray-400">{colTasks.length}</span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {colTasks.map((task: any) => (
                    <div key={task.id} className="bg-cc-900 border border-cc-700 rounded-lg p-3 group">
                      <div className="flex items-start justify-between gap-1 mb-1.5">
                        <div className={`text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS[0]}`}>
                          {PRIORITY_LABELS[task.priority] ?? 'Normal'}
                        </div>
                        <button
                          onClick={() => deleteMutation.mutate(task.id)}
                          className="text-cc-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="text-sm text-gray-200 font-medium leading-snug">{task.title}</div>
                      {task.description && <div className="text-xs text-cc-600 mt-1 line-clamp-2">{task.description}</div>}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {task.agencyName && <span className="text-xs bg-cc-800 px-1.5 py-0.5 rounded text-gray-400">{task.agency}</span>}
                        {task.dueDate && <span className="text-xs bg-cc-800 px-1.5 py-0.5 rounded text-gray-400">📅 {task.dueDate}</span>}
                        {task.assigneeName && <span className="text-xs bg-cc-800 px-1.5 py-0.5 rounded text-gray-400">👤 {task.assigneeName}</span>}
                      </div>
                      {/* Move buttons */}
                      <div className="mt-2 flex gap-1 flex-wrap">
                        {COLUMNS.filter(c => c.key !== col.key).map(c => (
                          <button
                            key={c.key}
                            onClick={() => moveMutation.mutate({ id: task.id, status: c.key })}
                            disabled={moveMutation.isPending}
                            className="text-xs text-cc-600 hover:text-gray-300 bg-cc-800 hover:bg-cc-700 px-1.5 py-0.5 rounded transition-colors"
                          >
                            → {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="text-center text-cc-600 text-xs py-6">Vide</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal nouvelle tâche */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-cc-900 border border-cc-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-cc-700">
              <h2 className="text-white font-semibold text-sm">Nouvelle tâche</h2>
              <button onClick={() => setShowNew(false)} className="text-cc-600 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            <form
              onSubmit={e => { e.preventDefault(); createMutation.mutate({ ...newTask, priority: Number(newTask.priority), dueDate: newTask.dueDate || undefined, agency: newTask.agency || undefined, description: newTask.description || undefined }); }}
              className="px-5 py-4 space-y-3"
            >
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Titre *</label>
                <input className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600" required value={newTask.title} onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Description</label>
                <textarea className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sinaur-600 h-16 resize-none" value={newTask.description} onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Priorité</label>
                  <select className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" value={newTask.priority} onChange={e => setNewTask(t => ({ ...t, priority: parseInt(e.target.value) }))}>
                    <option value={0}>Normal</option>
                    <option value={1}>Haute</option>
                    <option value={2}>Urgente</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Agence</label>
                  <input className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" value={newTask.agency} onChange={e => setNewTask(t => ({ ...t, agency: e.target.value }))} placeholder="OCHA, UNHCR…" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-cc-600 font-mono uppercase mb-1">Date limite</label>
                <input type="date" className="w-full bg-cc-800 border border-cc-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none" value={newTask.dueDate} onChange={e => setNewTask(t => ({ ...t, dueDate: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowNew(false)} className="cc-btn-ghost text-sm">Annuler</button>
                <button type="submit" disabled={createMutation.isPending} className="cc-btn-primary text-sm">{createMutation.isPending ? 'Création…' : 'Créer'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
