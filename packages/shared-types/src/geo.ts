import type { UUID, PCode, ISODate, GeoPoint, GeoPolygon, AuditTimestamps } from './common.js';

export type AdminLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ADMIN_LEVEL_NAMES: Record<AdminLevel, string> = {
  0: 'Pays',
  1: 'Province',
  2: 'Ville / Territoire',
  3: 'Commune / Secteur / Chefferie',
  4: 'Groupement',
  5: 'Quartier / Village',
  6: 'Localité',
};

export interface AdminDivision extends AuditTimestamps {
  id: UUID;
  pcode: PCode;
  name: string;
  nameFr: string;
  nameLocal?: string;
  level: AdminLevel;
  parentPcode: PCode | null;
  parentId: UUID | null;
  centroid: GeoPoint | null;
  bbox?: [number, number, number, number];
  population?: number;
  area_km2?: number;
  isActive: boolean;
}

export interface AdminDivisionWithGeometry extends AdminDivision {
  geometry: GeoPolygon | null;
}

export interface AdminHierarchy {
  pays: AdminDivision;
  province?: AdminDivision;
  territoire?: AdminDivision;
  commune?: AdminDivision;
  groupement?: AdminDivision;
  village?: AdminDivision;
}

export interface LocationReference {
  pcode: PCode;
  name: string;
  level: AdminLevel;
  coordinates?: GeoPoint;
  accuracy: 'gps' | 'pcode' | 'village' | 'territory' | 'province';
}

export const RDC_PROVINCES_PCODES: readonly string[] = [
  'CD01', 'CD02', 'CD03', 'CD04', 'CD05', 'CD06',
  'CD07', 'CD08', 'CD09', 'CD10', 'CD11', 'CD12',
  'CD13', 'CD14', 'CD15', 'CD16', 'CD17', 'CD18',
  'CD19', 'CD20', 'CD21', 'CD22', 'CD23', 'CD24',
  'CD25', 'CD26',
] as const;

export type ProvincePCode = (typeof RDC_PROVINCES_PCODES)[number];

export const RDC_COUNTRY_PCODE = 'COD' as const;
