import type { HazardType, AlertSeverity, ConfidenceLevel } from '@sinaur/shared-types';

export type ConnectorName = 'reliefweb' | 'fews_net' | 'open_meteo' | 'ocha_hdx' | 'mettelsat';

export interface RawEvent {
  sourceId: string;
  connector: ConnectorName;
  fetchedAt: Date;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedEvent {
  sourceId: string;
  source: ConnectorName;
  fetchedAt: Date;
  hazardType: HazardType;
  title: string;
  description: string;
  locationPcode: string | null;
  locationLat: number | null;
  locationLng: number | null;
  startDate: Date;
  severity: AlertSeverity;
  confidence: ConfidenceLevel;
  glideNumber: string | null;
  sourceUrl: string | null;
  rawPayload: Record<string, unknown>;
}

export interface ConnectorResult {
  connector: ConnectorName;
  fetched: number;
  normalized: number;
  stored: number;
  duplicates: number;
  errors: string[];
  durationMs: number;
}

export interface Connector {
  name: ConnectorName;
  fetch(): Promise<RawEvent[]>;
  normalize(raw: RawEvent): NormalizedEvent | null;
}
