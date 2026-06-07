export type UUID = string;
export type ISODate = string;
export type PCode = string;
export type GlideNumber = string;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export type GeoGeometry = GeoPoint | GeoPolygon;

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  pagination?: Pagination;
}

export interface AuditTimestamps {
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt?: ISODate;
}

export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'confirmed';

export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'error';
