import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import MapGL, { Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { apiClient } from '../lib/api.js';
import type {
  ResourceDepotSummary,
  ResourceDepotDetail,
  ResourceMovementRow,
  StockAlert,
} from '@sinaur/shared-types';

// ── Constantes ──────────────────────────────────────────────────────────────

const PCODE_CENTROID: Record<string, [number, number]> = {
  'CD-KN': [15.322, -4.322], 'CD-KC': [14.517, -5.058], 'CD-KG': [17.228, -6.498],
  'CD-KL': [18.222, -5.547], 'CD-MN': [18.834, -2.456], 'CD-KI': [21.982, -5.063],
  'CD-KE': [21.513, -6.042], 'CD-KO': [23.547, -6.056], 'CD-LO': [24.495, -4.513],
  'CD-SA': [23.546, -2.513], 'CD-MA': [27.041, -3.497], 'CD-SK': [28.234, -2.993],
  'CD-NK': [29.083, -0.984], 'CD-IT': [29.504,  1.504], 'CD-HU': [28.532,  3.496],
  'CD-TS': [25.512,  1.045], 'CD-BU': [23.505,  4.038], 'CD-NU': [21.480,  3.519],
  'CD-MO': [21.984,  1.492], 'CD-SU': [20.497,  3.007], 'CD-EQ': [19.488,  0.513],
  'CD-TC': [22.998, -0.513], 'CD-TA': [28.499, -6.501], 'CD-HL': [26.508, -7.489],
  'CD-LL': [25.490, -8.994], 'CD-HK': [27.493,-10.496],
};

const RES_LABEL: Record<string, string> = {
  food: 'Vivres', water: 'Eau', medicine: 'Médicaments', shelter_kit: 'Abris',
  nfi: 'NFI', hygiene_kit: 'Hygiène', fuel: 'Carburant', equipment: 'Équipement', other: 'Autre',
};

const MOV_LABEL: Record<string, string> = {
  in: '↑ Entrée', out: '↓ Sortie', transfer: '⇄ Transfert', adjustment: '= Ajust.',
};

const MOV_COLOR: Record<string, string> = {
  in: 'text-green-400', out: 'text-red-400',
  transfer: 'text-blue-400', adjustment: 'text-yellow-400',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function depotMarkerColor(d: ResourceDepotSummary): string {
  if (d.lowStockCount === 0) return '#22c55e';
  if (d.lowStockCount <= 2) return '#f59e0b';
  return '#ef4444';
}

function stockStatusClass(qty: number, thr: number) {
  if (thr === 0) return { bar: 'bg-green-500', text: 'text-green-400' };
  if (qty <= thr) return { bar: 'bg-red-500', text: 'text-red-400' };
  if (qty <= thr * 1.5) return { bar: 'bg-amber-500', text: 'text-amber-400' };
  return { bar: 'bg-green-500', text: 'text-green-400' };
}

function markerCoords(d: ResourceDepotSummary, idx: number): [number, number] {
  const prov = d.pcode.length >= 5 ? d.pcode.substring(0, 5) : d.pcode;
  const base = PCODE_CENTROID[prov] ?? [24.0, -4.0];
  // Décalage léger pour éviter la superposition de plusieurs dépôts dans la même province
  const jitter = 0.18;
  return [
    base[0] + ((idx * 7 + 3) % 9 - 4) * jitter * 0.5,
    base[1] + ((idx * 5 + 1) % 7 - 3) * jitter * 0.4,
  ];
}

// ── Composant principal ───────────────────────────────────────────────────────

export function StocksPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: depotsRaw, refetch: refetchDepots } = useQuery({
    queryKey: ['cc-stocks-depots'],
    queryFn: () => apiClient.get('/resources/depots').then(r => r.data.data as ResourceDepotSummary[]),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: alertsRaw, refetch: refetchAlerts } = useQuery({
    queryKey: ['cc-stocks-alerts'],
    queryFn: () => apiClient.get('/resources/alerts').then(r => r.data.data as StockAlert[]),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: detail } = useQuery({
    queryKey: ['cc-depot-detail', selectedId],
    queryFn: () => apiClient.get(`/resources/depots/${selectedId}`).then(r => r.data.data as ResourceDepotDetail),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const { data: movements } = useQuery({
    queryKey: ['cc-depot-movements', selectedId],
    queryFn: () => apiClient.get(`/resources/depots/${selectedId}/movements?limit=10`).then(r => r.data.data as ResourceMovementRow[]),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const depots = depotsRaw ?? [];
  const alerts = alertsRaw ?? [];

  const activeDepots   = depots.filter(d => d.isActive).length;
  const totalLines     = depots.reduce((s, d) => s + d.stockLines, 0);
  const totalUnits     = depots.reduce((s, d) => s + Number(d.totalUnits), 0);
  const criticalDepots = depots.filter(d => d.lowStockCount > 0).length;

  const sortedDepots = [...depots].sort((a, b) => b.lowStockCount - a.lowStockCount);

  function refresh() { refetchDepots(); refetchAlerts(); }

  return (
    <div className="flex h-full">

      {/* ── Panneau gauche ── */}
      <div className="w-80 shrink-0 bg-cc-900 border-r border-cc-700 flex flex-col overflow-hidden">

        {/* En-tête */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cc-700">
          <div className="flex items-center gap-2">
            <span>📦</span>
            <span className="text-sm font-semibold text-white">Stocks humanitaires</span>
          </div>
          <button onClick={refresh} title="Actualiser" className="cc-btn cc-btn-ghost px-2 py-1 text-xs">↺</button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-px bg-cc-700 border-b border-cc-700">
          {([
            { label: 'Dépôts actifs',    value: activeDepots,                       cls: 'text-white' },
            { label: 'Stocks critiques', value: alerts.length,                       cls: alerts.length > 0 ? 'text-red-400' : 'text-green-400' },
            { label: 'Lignes en stock',  value: totalLines,                          cls: 'text-white' },
            { label: 'Unités dispo.',    value: totalUnits > 999 ? `${(totalUnits / 1000).toFixed(1)}k` : totalUnits, cls: 'text-white' },
          ] as const).map(k => (
            <div key={k.label} className="bg-cc-900 px-3 py-2.5">
              <div className={`text-xl font-bold font-mono leading-none ${k.cls}`}>{k.value}</div>
              <div className="text-[11px] text-cc-600 mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Alertes seuil */}
        {alerts.length > 0 && (
          <div className="border-b border-cc-700 shrink-0">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-[11px] font-mono text-cc-600 uppercase tracking-wider">Alertes seuil</span>
              <span className="cc-badge bg-red-900/80 text-red-300">{alerts.length}</span>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {alerts.map(a => (
                <button
                  key={a.stockId}
                  onClick={() => setSelectedId(a.depotId)}
                  className="w-full text-left px-4 py-2 hover:bg-cc-800 transition-colors border-t border-cc-800 first:border-t-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{a.resourceName}</div>
                      <div className="text-[11px] text-cc-600 truncate">{a.depotName} · {a.pcode}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono text-red-400">{Number(a.quantityAvailable).toLocaleString('fr')} {a.unit}</div>
                      <div className="text-[11px] text-cc-600">seuil {Number(a.minimumThreshold).toLocaleString('fr')}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Liste dépôts */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-cc-700 shrink-0">
          <span className="text-[11px] font-mono text-cc-600 uppercase tracking-wider">
            Dépôts ({depots.length})
          </span>
          {criticalDepots > 0 && (
            <span className="text-[11px] text-amber-400">{criticalDepots} en alerte</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sortedDepots.map(d => (
            <button
              key={d.id}
              onClick={() => setSelectedId(selectedId === d.id ? null : d.id)}
              className={[
                'w-full text-left px-4 py-2.5 hover:bg-cc-800 transition-colors border-b border-cc-800',
                selectedId === d.id ? 'bg-cc-800 border-l-2 border-l-sinaur-500' : '',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: depotMarkerColor(d) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-white truncate">{d.name}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-cc-600 font-mono">{d.pcode}</span>
                    <span className="text-[11px] text-cc-600">{d.stockLines} lig.</span>
                    {d.lowStockCount > 0
                      ? <span className="text-[11px] text-red-400">⚠ {d.lowStockCount} critique{d.lowStockCount > 1 ? 's' : ''}</span>
                      : <span className="text-[11px] text-green-500">✓ OK</span>
                    }
                  </div>
                </div>
              </div>
            </button>
          ))}
          {depots.length === 0 && (
            <p className="text-xs text-cc-600 text-center py-10">Aucun dépôt enregistré</p>
          )}
        </div>
      </div>

      {/* ── Panneau droit ── */}
      <div className="flex-1 overflow-hidden">
        {selectedId && detail ? (
          <DepotDetailView
            detail={detail}
            movements={movements ?? []}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <MapView depots={depots} onSelect={setSelectedId} />
        )}
      </div>
    </div>
  );
}

// ── Vue carte ────────────────────────────────────────────────────────────────

const STOCKS_MAP_STYLE = {
  version: 8 as const,
  sources: { osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
  layers: [
    { id: 'bg', type: 'background' as const, paint: { 'background-color': '#0d1b2a' } },
    { id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.30, 'raster-opacity': 0.85 } },
  ],
};

function MapView({
  depots,
  onSelect,
}: {
  depots: ResourceDepotSummary[];
  onSelect: (id: string) => void;
}) {
  const activeDepots = depots.filter(d => d.isActive);

  return (
    <div className="relative h-full">
      <MapGL
        initialViewState={{ longitude: 24.0, latitude: -4.0, zoom: 5.0 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={STOCKS_MAP_STYLE}
      >
        {activeDepots.map((d, i) => {
          const [lng, lat] = markerCoords(d, i);
          const color = depotMarkerColor(d);
          return (
            <Marker key={d.id} longitude={lng} latitude={lat} anchor="center">
              <button
                onClick={() => onSelect(d.id)}
                title={`${d.name} (${d.pcode})`}
                className="relative flex items-center justify-center group"
              >
                <span
                  className="absolute w-8 h-8 rounded-full opacity-25 group-hover:opacity-40 transition-opacity"
                  style={{ backgroundColor: color }}
                />
                <span
                  className="relative w-4 h-4 rounded-full border-2 border-white shadow-lg transition-transform group-hover:scale-125"
                  style={{ backgroundColor: color }}
                />
              </button>
            </Marker>
          );
        })}
      </MapGL>

      {/* Légende */}
      <div className="absolute bottom-4 right-4 bg-cc-900/92 border border-cc-700 rounded-xl p-3 backdrop-blur-sm">
        <div className="text-[10px] font-mono text-cc-600 uppercase tracking-wider mb-2">Statut dépôt</div>
        {[
          { color: '#22c55e', label: 'Tout OK' },
          { color: '#f59e0b', label: '1–2 articles critiques' },
          { color: '#ef4444', label: '3+ articles critiques' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-2 mb-1.5 last:mb-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
            <span className="text-xs text-gray-400">{l.label}</span>
          </div>
        ))}
        <div className="border-t border-cc-700 mt-2 pt-2 text-[11px] text-cc-600 font-mono">
          {activeDepots.length} dépôt{activeDepots.length !== 1 ? 's' : ''} actif{activeDepots.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Instruction */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-cc-900/80 border border-cc-700 rounded-lg px-3 py-1.5 text-xs text-cc-600 backdrop-blur-sm pointer-events-none">
        Cliquer sur un dépôt pour voir le détail des stocks
      </div>
    </div>
  );
}

// ── Vue détail dépôt ─────────────────────────────────────────────────────────

function DepotDetailView({
  detail,
  movements,
  onClose,
}: {
  detail: ResourceDepotDetail;
  movements: ResourceMovementRow[];
  onClose: () => void;
}) {
  const criticalCount = detail.stocks.filter(s => {
    const qty = Number(s.quantityAvailable);
    const thr = Number(s.minimumThreshold);
    return thr > 0 && qty <= thr;
  }).length;

  return (
    <div className="h-full flex flex-col bg-cc-950 overflow-hidden">

      {/* En-tête détail */}
      <div className="flex items-center gap-3 px-5 py-3 bg-cc-900 border-b border-cc-700 shrink-0">
        <button onClick={onClose} className="cc-btn cc-btn-ghost px-2 py-1 text-xs shrink-0">
          ← Carte
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold truncate">{detail.name}</span>
            <span className="cc-badge bg-cc-800 text-cc-500 font-mono text-[10px]">{detail.pcode}</span>
            {criticalCount > 0 && (
              <span className="cc-badge bg-red-900/80 text-red-300">{criticalCount} critique{criticalCount > 1 ? 's' : ''}</span>
            )}
          </div>
          {(detail.managerName || detail.address) && (
            <div className="text-[11px] text-cc-600 mt-0.5 truncate">
              {[detail.managerName, detail.address].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <span className={`cc-badge shrink-0 ${detail.isActive ? 'bg-green-900/60 text-green-400' : 'bg-cc-800 text-cc-600'}`}>
          {detail.isActive ? 'Actif' : 'Inactif'}
        </span>
      </div>

      {/* Corps */}
      <div className="flex-1 overflow-y-auto">

        {/* Stocks */}
        <div className="p-5">
          <div className="text-[11px] font-mono text-cc-600 uppercase tracking-wider mb-3">
            Inventaire — {detail.stocks.length} ligne{detail.stocks.length !== 1 ? 's' : ''}
          </div>

          {detail.stocks.length === 0 ? (
            <p className="text-sm text-cc-600 text-center py-10">Aucun stock enregistré</p>
          ) : (
            <div className="space-y-2">
              {[...detail.stocks].sort((a, b) => {
                // Critiques en premier
                const aCrit = Number(a.quantityAvailable) <= Number(a.minimumThreshold) && Number(a.minimumThreshold) > 0;
                const bCrit = Number(b.quantityAvailable) <= Number(b.minimumThreshold) && Number(b.minimumThreshold) > 0;
                if (aCrit && !bCrit) return -1;
                if (!aCrit && bCrit) return 1;
                return a.resourceName.localeCompare(b.resourceName);
              }).map(s => {
                const qty = Number(s.quantityAvailable);
                const thr = Number(s.minimumThreshold);
                const res = Number(s.quantityReserved);
                const pct = thr > 0 ? Math.min(qty / (thr * 2), 1) * 100 : 100;
                const { bar, text } = stockStatusClass(qty, thr);

                return (
                  <div key={s.id} className="cc-card p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium leading-tight">{s.resourceName}</div>
                        <div className="text-[11px] text-cc-600 mt-0.5">
                          {RES_LABEL[s.resourceType] ?? s.resourceType}
                          {s.crisisGlide && <span className="ml-1.5 font-mono">{s.crisisGlide}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-mono font-bold ${text}`}>
                          {qty.toLocaleString('fr')} {s.unit}
                        </div>
                        {thr > 0 && (
                          <div className="text-[11px] text-cc-600">
                            seuil {thr.toLocaleString('fr')}
                          </div>
                        )}
                      </div>
                    </div>

                    {thr > 0 && (
                      <div className="h-1.5 bg-cc-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}

                    {res > 0 && (
                      <div className="text-[11px] text-cc-600 mt-1.5">
                        Réservé : {res.toLocaleString('fr')} {s.unit}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Mouvements récents */}
        {movements.length > 0 && (
          <div className="px-5 pb-5">
            <div className="text-[11px] font-mono text-cc-600 uppercase tracking-wider mb-3">
              Mouvements récents
            </div>
            <div className="cc-card divide-y divide-cc-700">
              {movements.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`text-[11px] font-mono font-semibold w-20 shrink-0 ${MOV_COLOR[m.movementType] ?? 'text-gray-400'}`}>
                    {MOV_LABEL[m.movementType] ?? m.movementType}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300 truncate">{m.resourceName}</div>
                    {m.reason && (
                      <div className="text-[11px] text-cc-600 truncate">{m.reason}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono text-white">
                      {Number(m.quantity).toLocaleString('fr')} {m.unit}
                    </div>
                    <div className="text-[11px] text-cc-600">
                      {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: fr })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
