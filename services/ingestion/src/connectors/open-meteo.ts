/**
 * Connecteur Open-Meteo (météo ouverte, gratuite, sans clé API)
 * https://open-meteo.com/en/docs
 *
 * Surveille les précipitations et températures pour les 26 provinces RDC.
 * Génère des événements si les seuils d'alerte météo sont dépassés.
 */
import type { Connector, RawEvent, NormalizedEvent } from '../types.js';
import type { HazardType, AlertSeverity } from '@sinaur/shared-types';

// Capitales provinciales avec P-codes — centroïdes approximatifs
const PROVINCE_POINTS: Array<{ pcode: string; name: string; lat: number; lng: number }> = [
  { pcode: 'CD01', name: 'Kinshasa',       lat: -4.322,  lng: 15.322 },
  { pcode: 'CD02', name: 'Kongo-Central',  lat: -5.521,  lng: 13.433 },
  { pcode: 'CD03', name: 'Kwango',         lat: -5.983,  lng: 17.466 },
  { pcode: 'CD04', name: 'Kwilu',          lat: -3.317,  lng: 17.367 },
  { pcode: 'CD05', name: 'Maï-Ndombe',     lat: -2.000,  lng: 18.250 },
  { pcode: 'CD06', name: 'Kasaï',          lat: -5.229,  lng: 22.379 },
  { pcode: 'CD07', name: 'Kasaï-Central',  lat: -5.898,  lng: 22.416 },
  { pcode: 'CD08', name: 'Kasaï-Oriental', lat: -6.136,  lng: 23.590 },
  { pcode: 'CD11', name: 'Maniema',        lat: -2.949,  lng: 26.082 },
  { pcode: 'CD12', name: 'Sud-Kivu',       lat: -2.507,  lng: 28.850 },
  { pcode: 'CD14', name: 'Nord-Kivu',      lat: -1.679,  lng: 29.224 },
  { pcode: 'CD15', name: 'Ituri',          lat:  1.556,  lng: 30.186 },
  { pcode: 'CD16', name: 'Haut-Uélé',      lat:  3.021,  lng: 28.193 },
  { pcode: 'CD17', name: 'Tshopo',         lat:  0.514,  lng: 25.196 },
  { pcode: 'CD18', name: 'Bas-Uélé',       lat:  3.058,  lng: 24.178 },
  { pcode: 'CD22', name: 'Équateur',       lat:  0.044,  lng: 18.260 },
  { pcode: 'CD24', name: 'Tanganyika',     lat: -5.917,  lng: 29.167 },
  { pcode: 'CD25', name: 'Haut-Lomami',    lat: -7.560,  lng: 26.880 },
  { pcode: 'CD26', name: 'Lualaba',        lat: -9.367,  lng: 25.466 },
  { pcode: 'CD27', name: 'Haut-Katanga',   lat:-11.660,  lng: 27.479 },
];

const FLOOD_RAIN_MM_THRESHOLD  = 80;  // mm/jour → risque inondation
const HIGH_RAIN_MM_THRESHOLD   = 50;  // mm/jour → vigilance
const DROUGHT_NO_RAIN_DAYS     = 20;  // jours sans pluie → sécheresse

export class OpenMeteoConnector implements Connector {
  name = 'open_meteo' as const;

  async fetch(): Promise<RawEvent[]> {
    const results: RawEvent[] = [];

    // Requêtes parallèles pour tous les points (max 5 simultanées)
    const chunks = chunkArray(PROVINCE_POINTS, 5);
    for (const chunk of chunks) {
      const fetched = await Promise.allSettled(
        chunk.map((point) => this.fetchPoint(point)),
      );
      for (const res of fetched) {
        if (res.status === 'fulfilled' && res.value) results.push(res.value);
      }
    }

    return results;
  }

  private async fetchPoint(point: { pcode: string; lat: number; lng: number }): Promise<RawEvent | null> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(point.lat));
    url.searchParams.set('longitude', String(point.lng));
    url.searchParams.set('daily', 'precipitation_sum,precipitation_hours,temperature_2m_max,temperature_2m_min,wind_speed_10m_max');
    url.searchParams.set('timezone', 'Africa/Kinshasa');
    url.searchParams.set('past_days', '7');
    url.searchParams.set('forecast_days', '7');

    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return null;

    const data = await resp.json() as Record<string, unknown>;
    return {
      sourceId: `meteo:${point.pcode}:${new Date().toISOString().slice(0, 10)}`,
      connector: this.name,
      fetchedAt: new Date(),
      rawPayload: { ...data, pcode: point.pcode },
    };
  }

  normalize(raw: RawEvent): NormalizedEvent | null {
    const f = raw.rawPayload;
    const pcode = String(f['pcode'] ?? 'COD');
    const daily = f['daily'] as { precipitation_sum?: number[]; time?: string[] } | undefined;
    const precipData = daily?.precipitation_sum ?? [];
    const timeData = daily?.time ?? [];

    if (precipData.length === 0) return null;

    // Trouver le maximum sur les 7 derniers jours
    const pastPrecip = precipData.slice(0, 7);
    const maxPrecip = Math.max(...pastPrecip.filter((v): v is number => v != null && !isNaN(v)));
    const maxIdx = pastPrecip.indexOf(maxPrecip);
    const maxDate = timeData[maxIdx] ?? new Date().toISOString().slice(0, 10);

    // Nombre de jours secs consécutifs (pour sécheresse)
    let dryDays = 0;
    for (let i = pastPrecip.length - 1; i >= 0; i--) {
      if ((pastPrecip[i] ?? 0) < 1) dryDays++; else break;
    }

    let hazardType: HazardType | null = null;
    let severity: AlertSeverity = 'Unknown';
    let title = '';

    if (maxPrecip >= FLOOD_RAIN_MM_THRESHOLD) {
      hazardType = 'flood';
      severity = maxPrecip >= 120 ? 'Extreme' : maxPrecip >= 100 ? 'Severe' : 'Moderate';
      title = `Alerte météo — fortes précipitations (${Math.round(maxPrecip)} mm) — ${pcode}`;
    } else if (dryDays >= DROUGHT_NO_RAIN_DAYS) {
      hazardType = 'drought';
      severity = dryDays >= 30 ? 'Severe' : 'Moderate';
      title = `Alerte sécheresse — ${dryDays} jours sans pluie — ${pcode}`;
    } else if (maxPrecip >= HIGH_RAIN_MM_THRESHOLD) {
      hazardType = 'flood';
      severity = 'Minor';
      title = `Surveillance pluies — ${Math.round(maxPrecip)} mm — ${pcode}`;
    }

    if (!hazardType) return null;

    return {
      sourceId: raw.sourceId,
      source: this.name,
      fetchedAt: raw.fetchedAt,
      hazardType,
      title,
      description: `Données météo Open-Meteo pour la province ${pcode}. Précipitations max: ${Math.round(maxPrecip)} mm. Jours secs: ${dryDays}.`,
      locationPcode: pcode,
      locationLat: Number((f['latitude'] as number | undefined) ?? null),
      locationLng: Number((f['longitude'] as number | undefined) ?? null),
      startDate: new Date(maxDate),
      severity,
      confidence: 'medium',
      glideNumber: null,
      sourceUrl: 'https://open-meteo.com',
      rawPayload: f,
    };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}
