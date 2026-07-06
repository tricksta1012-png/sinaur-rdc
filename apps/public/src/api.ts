import axios from 'axios';

const api = axios.create({ baseURL: '/public', timeout: 15_000 });

export interface PublicAlert {
  identifier: string
  sentAt: string
  status: string
  msgType: string
  category: string
  event: string
  urgency: string
  severity: string
  certainty: string
  headline: string
  areaName: string
  areaPcode: string
}

export interface PublicEvent {
  id: string
  hazardType: string
  severity: string
  locationPcode: string
  locationName: string
  provinceName: string
  source: string
  createdAt: string
  description: string
}

export interface PublicStats {
  totalEvents: number
  events7d: number
  affectedProvinces: number
  activeAlerts: number
  byHazardType: { hazardType: string; count: number }[]
  byProvince: {
    pcode: string
    nameFr: string
    events30d: number
    events7d: number
    activeAlerts: number
    lastEventAt: string | null
  }[]
  trend: { statDate: string; hazardType: string; eventCount: number }[]
}

export interface GeoFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown>
}

export interface GeoCollection {
  type: 'FeatureCollection'
  features: GeoFeature[]
}

export const publicApi = {
  getAlerts: () =>
    api.get<{ success: true; data: PublicAlert[] }>('/alerts').then(r => r.data.data),

  getEvents: (page = 1, limit = 20) =>
    api.get<{ success: true; data: PublicEvent[]; meta: { total: number; page: number; limit: number } }>(
      '/events', { params: { page, limit } }
    ).then(r => r.data),

  getStats: () =>
    api.get<{ success: true; data: PublicStats }>('/stats').then(r => r.data.data),

  getProvinceGeo: () =>
    api.get<GeoCollection>('/geo/provinces').then(r => r.data),

  getEventsMap: () =>
    api.get<GeoCollection>('/events/map').then(r => r.data),
}
