/**
 * Connecteur FEWS NET — Famine Early Warning Systems Network
 * API publique : https://fews.net/api/v1/
 * Données : sécurité alimentaire, sécheresse, crise humanitaire RDC
 */
import type { Connector, RawEvent, NormalizedEvent } from '../types.js';
import type { HazardType, AlertSeverity } from '@sinaur/shared-types';

// IPC phases → severity
const IPC_SEVERITY: Record<number, AlertSeverity> = {
  1: 'Minor',
  2: 'Moderate',
  3: 'Severe',
  4: 'Extreme',
  5: 'Extreme',
};

export class FewsNetConnector implements Connector {
  name = 'fews_net' as const;

  async fetch(): Promise<RawEvent[]> {
    // FEWS NET API v1 — données IPC pour la RDC
    const url = 'https://fdw.fews.net/api/ipcphasemap/?country_code=CD&format=json&limit=20';

    try {
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'sinaur-rdc/0.1 contact@sinaur-rdc.cd' },
        signal: AbortSignal.timeout(20_000),
      });

      if (!resp.ok) {
        // FEWS NET peut retourner 403/404 selon la disponibilité — graceful fallback
        return [];
      }

      const data = await resp.json() as { results?: unknown[] };
      return (data.results ?? []).map((item, i) => ({
        sourceId: `fewsnet:${Date.now()}:${i}`,
        connector: this.name,
        fetchedAt: new Date(),
        rawPayload: item as Record<string, unknown>,
      }));
    } catch {
      // FEWS NET indisponible → ne pas bloquer le pipeline
      return [];
    }
  }

  normalize(raw: RawEvent): NormalizedEvent | null {
    const f = raw.rawPayload;
    const ipcPhase = Number(f['phase'] ?? f['ipc_phase'] ?? 0);
    if (ipcPhase < 3) return null; // Phases 1-2 : pas d'alerte

    const hazardType: HazardType = ipcPhase >= 4 ? 'humanitarian_crisis' : 'drought';
    const severity: AlertSeverity = IPC_SEVERITY[ipcPhase] ?? 'Moderate';

    return {
      sourceId: raw.sourceId,
      source: this.name,
      fetchedAt: raw.fetchedAt,
      hazardType,
      title: `FEWS NET — Insécurité alimentaire Phase IPC ${ipcPhase} — RDC`,
      description: JSON.stringify(f).slice(0, 500),
      locationPcode: String(f['admin1_code'] ?? 'COD'),
      locationLat: null,
      locationLng: null,
      startDate: new Date(String(f['period_date'] ?? f['created'] ?? Date.now())),
      severity,
      confidence: 'high',
      glideNumber: null,
      sourceUrl: 'https://fews.net',
      rawPayload: f,
    };
  }
}
