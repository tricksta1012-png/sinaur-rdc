export type ResourceType =
  | 'food' | 'water' | 'medicine' | 'shelter_kit'
  | 'nfi' | 'hygiene_kit' | 'fuel' | 'equipment' | 'other'

export type MovementType = 'in' | 'out' | 'transfer' | 'adjustment'

export interface ResourceDepotSummary {
  id: string
  name: string
  pcode: string
  address: string | null
  isActive: boolean
  managerName: string | null
  stockLines: number
  totalUnits: string
  lowStockCount: number
  createdAt: string
}

export interface ResourceStock {
  id: string
  depotId: string
  resourceType: ResourceType
  resourceName: string
  unit: string
  quantityAvailable: string
  quantityReserved: string
  minimumThreshold: string
  crisisId: string | null
  crisisGlide: string | null
  createdAt: string
  updatedAt: string
}

export interface ResourceDepotDetail extends Omit<ResourceDepotSummary, 'stockLines' | 'totalUnits' | 'lowStockCount'> {
  managerId: string | null
  updatedAt: string
  stocks: ResourceStock[]
}

export interface ResourceMovementRow {
  id: string
  movementType: MovementType
  quantity: string
  reason: string | null
  createdAt: string
  resourceName: string
  unit: string
  createdByName: string | null
}

export interface StockAlert {
  stockId: string
  resourceName: string
  unit: string
  quantityAvailable: string
  minimumThreshold: string
  gap: string
  depotId: string
  depotName: string
  pcode: string
}

export type DemandStatus = 'pending' | 'approved' | 'rejected' | 'fulfilled'
export type DemandUrgency = 'low' | 'normal' | 'high' | 'critical'

export interface ResourceDemand {
  id: string
  crisisId: string
  crisisGlide: string
  crisisTitle: string
  depotId: string | null
  depotName: string | null
  stockId: string | null
  resourceType: ResourceType
  resourceName: string
  unit: string
  quantityNeeded: string
  quantityAllocated: string | null
  urgency: DemandUrgency
  status: DemandStatus
  notes: string | null
  requestedByName: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}
