/**
 * Connecteur ReliefWeb API (UN OCHA)
 * Docs : https://apidoc.reliefweb.int/
 * Filtre : country = "Democratic Republic of the Congo"
 */
import type { Connector, RawEvent, NormalizedEvent } from '../types.js';
import type { HazardType, AlertSeverity } from '@sinaur/shared-types';
import { logger } from '../logger.js';

const API_BASE = process.env['RELIEFWEB_API_URL'] ?? 'https://api.reliefweb.int/v1';
const APP_NAME = process.env['RELIEFWEB_APP_NAME'] ?? 'sinaur-rdc';

const DISASTER_TYPE_MAP: Record<string, HazardType> = {
  'Flash Flood': 'flood',
  'Flood': 'flood',
  'Tropical Cyclone': 'flood',
  'Landslide': 'landslide',
  'Mudslide': 'landslide',
  'Epidemic': 'health_epidemic',
  'Cholera': 'health_epidemic',
  'Ebola': 'health_epidemic',
  'Measles': 'health_epidemic',
  'COVID-19': 'health_epidemic',
  'Drought': 'drought',
  'Earthquake': 'earthquake',
  'Volcano': 'volcanic_eruption',
  'Cold Wave': 'other',
  'Fire': 'fire',
  'Complex Emergency': 'humanitarian_crisis',
  'Conflict': 'conflict',
  'Violence': 'conflict',
  'Population Movement': 'mass_displacement',
  'Displacement': 'mass_displacement',
};

const SEVERITY_MAP: Record<string, AlertSeverity> = {
  'red': 'Extreme',
  'orange': 'Severe',
  'yellow': 'Moderate',
  'green': 'Minor',
};

export class ReliefWebConnector implements Connector {
  name = 'reliefweb' as const;

  async fetch(): Promise<RawEvent[]> {
    const payload = {
      appname: APP_NAME,
      query: { value: 'country:"Democratic Republic of the Congo"', operator: 'AND' },
      filter: {
        operator: 'AND',
        conditions: [
          { field: 'country.iso3', value: 'COD' },
          { field: 'date.created', value: { from: this.getDateFrom() } },
        ],
      },
      fields: { include: ['id','title','body','date','disaster_type','severity','glide','url','country','primary_country'] },
      limit: 50,
      sort: ['date.created:desc'],
    };

    const response = await fetch(`${API_BASE}/disasters?appname=${APP_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`ReliefWeb API HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { data: Array<{ id: number; fields: Record<string, unknown> }> };
    return (data.data ?? []).map((item) => ({
      sourceId: String(item.id),
      connector: this.name,
      fetchedAt: new Date(),
      rawPayload: item.fields,
    }));
  }

  normalize(raw: RawEvent): NormalizedEvent | null {
    const f = raw.rawPayload;
    const disasterTypes = (f['disaster_type'] as Array<{ name: string }> | undefined) ?? [];
    const primaryType = disasterTypes[0]?.name ?? 'Complex Emergency';

    const hazardType: HazardType = DISASTER_TYPE_MAP[primaryType] ?? 'other';
    const glideRaw = f['glide'] as Array<{ id: string }> | undefined;
    const glideNumber = glideRaw?.[0]?.id ?? null;

    const severity: AlertSeverity = SEVERITY_MAP[(f['severity'] as string | undefined)?.toLowerCase() ?? ''] ?? 'Unknown';

    const dateObj = f['date'] as { created?: string; event?: string } | undefined;
    const startDate = new Date(dateObj?.event ?? dateObj?.created ?? Date.now());

    if (isNaN(startDate.getTime())) return null;

    return {
      sourceId: raw.sourceId,
      source: this.name,
      fetchedAt: raw.fetchedAt,
      hazardType,
      title: String(f['title'] ?? '').slice(0, 200),
      description: String(f['body'] ?? '').slice(0, 2000),
      locationPcode: 'COD',
      locationLat: null,
      locationLng: null,
      startDate,
      severity,
      confidence: 'high',
      glideNumber,
      sourceUrl: String(f['url'] ?? ''),
      rawPayload: f,
    };
  }

  private getDateFrom(): string {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
}
