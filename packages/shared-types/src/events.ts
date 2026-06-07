import type { UUID, ISODate, PCode, GlideNumber, ConfidenceLevel, AuditTimestamps } from './common.js';
import type { HazardType, AlertSeverity } from './alerts.js';
import type { LocationReference } from './geo.js';
import type { UserPublic } from './users.js';

export type EventStatus = 'reported' | 'under_review' | 'validated' | 'active' | 'resolved' | 'rejected';
export type EventSource = 'citizen' | 'field_agent' | 'ai_prediction' | 'reliefweb' | 'fews_net' | 'mettelsat' | 'ocha' | 'official' | 'other';

export interface EventMedia {
  id: UUID;
  type: 'photo' | 'video' | 'audio' | 'document';
  url: string;
  thumbnailUrl?: string;
  uploadedAt: ISODate;
  uploadedBy: UUID;
  fileSizeBytes: number;
  mimeType: string;
}

export interface DisasterEvent extends AuditTimestamps {
  id: UUID;
  title: string;
  description: string;
  hazardType: HazardType;
  status: EventStatus;
  severity: AlertSeverity;
  confidence: ConfidenceLevel;
  source: EventSource;
  sourceUrl?: string;
  sourceRef?: string;
  glideNumber?: GlideNumber;
  location: LocationReference;
  affectedPcodes: PCode[];
  estimatedAffected?: number;
  reportedBy: UserPublic | null;
  validatedBy?: UserPublic;
  validatedAt?: ISODate;
  startDate: ISODate;
  endDate?: ISODate;
  media: EventMedia[];
  tags: string[];
  isFlaggedSensitive: boolean;
  relatedAlertIds: UUID[];
  relatedEventIds: UUID[];
  syncStatus: 'pending' | 'synced';
  clientCreatedAt?: ISODate;
}

export interface EventCreateInput {
  title: string;
  description: string;
  hazardType: HazardType;
  severity: AlertSeverity;
  source: EventSource;
  location: LocationReference;
  estimatedAffected?: number;
  startDate: ISODate;
  mediaIds?: UUID[];
  tags?: string[];
}

export interface EventFilters {
  hazardTypes?: HazardType[];
  statuses?: EventStatus[];
  provinces?: PCode[];
  severities?: AlertSeverity[];
  dateFrom?: ISODate;
  dateTo?: ISODate;
  sources?: EventSource[];
  search?: string;
}

export interface CanonicalEvent {
  id: UUID;
  sourceId: string;
  source: EventSource;
  fetchedAt: ISODate;
  normalizedAt: ISODate;
  hazardType: HazardType;
  title: string;
  description: string;
  location: LocationReference;
  startDate: ISODate;
  severity: AlertSeverity;
  confidence: ConfidenceLevel;
  glideNumber?: GlideNumber;
  sourceUrl?: string;
  rawPayload: Record<string, unknown>;
  isDuplicate: boolean;
  deduplicationHash: string;
}
