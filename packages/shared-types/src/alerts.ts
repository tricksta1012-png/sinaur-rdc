import type { UUID, ISODate, PCode, GlideNumber, GeoPoint, GeoPolygon, AuditTimestamps } from './common.js';
import type { UserPublic } from './users.js';

export type HazardType =
  | 'flood'
  | 'landslide'
  | 'mass_displacement'
  | 'humanitarian_crisis'
  | 'health_epidemic'
  | 'volcanic_eruption'
  | 'drought'
  | 'fire'
  | 'conflict'
  | 'earthquake'
  | 'other';

export const HAZARD_TYPE_LABELS_FR: Record<HazardType, string> = {
  flood: 'Inondation',
  landslide: 'Glissement de terrain',
  mass_displacement: 'Déplacement massif de populations',
  humanitarian_crisis: 'Crise humanitaire',
  health_epidemic: 'Épidémie / Risque sanitaire',
  volcanic_eruption: 'Éruption volcanique',
  drought: 'Sécheresse',
  fire: 'Incendie',
  conflict: 'Conflit armé',
  earthquake: 'Tremblement de terre',
  other: 'Autre',
};

export type AlertSeverity = 'Minor' | 'Moderate' | 'Severe' | 'Extreme' | 'Unknown';
export type AlertUrgency = 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
export type AlertCertainty = 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown';
export type AlertStatus = 'Actual' | 'Exercise' | 'System' | 'Test' | 'Draft';
export type AlertScope = 'Public' | 'Restricted' | 'Private';
export type AlertMsgType = 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';

/**
 * CAP 1.2 compliant alert structure.
 * Ref: ITU-T X.1303 / OASIS CAP-1.2
 */
export interface CAPInfo {
  language: string;
  category: string[];
  event: string;
  responseType?: string[];
  urgency: AlertUrgency;
  severity: AlertSeverity;
  certainty: AlertCertainty;
  audience?: string;
  eventCode?: Array<{ valueName: string; value: string }>;
  effective?: ISODate;
  onset?: ISODate;
  expires?: ISODate;
  senderName: string;
  headline: string;
  description?: string;
  instruction?: string;
  web?: string;
  contact?: string;
  parameter?: Array<{ valueName: string; value: string }>;
  area: CAPArea[];
}

export interface CAPArea {
  areaDesc: string;
  polygon?: string[];
  circle?: string[];
  geocode?: Array<{ valueName: string; value: string }>;
  altitude?: number;
  ceiling?: number;
}

export interface CAPAlert extends AuditTimestamps {
  id: UUID;
  identifier: string;
  sender: string;
  sent: ISODate;
  status: AlertStatus;
  msgType: AlertMsgType;
  source?: string;
  scope: AlertScope;
  restriction?: string;
  addresses?: string;
  code?: string[];
  note?: string;
  references?: string;
  incidents?: string;
  info: CAPInfo[];
  glideNumber?: GlideNumber;
  issuedByAI: boolean;
  validatedBy?: UserPublic;
  validatedAt?: ISODate;
  relatedEventId?: UUID;
}

export type AlertChannel = 'push' | 'sms' | 'ussd' | 'whatsapp' | 'web' | 'email';

export interface AlertDelivery {
  alertId: UUID;
  channel: AlertChannel;
  recipientPcodes: PCode[];
  sentAt: ISODate;
  deliveredCount: number;
  failedCount: number;
}
