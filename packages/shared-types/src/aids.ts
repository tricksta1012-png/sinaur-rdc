import type { UUID, ISODate, PCode, AuditTimestamps } from './common.js';
import type { UserPublic } from './users.js';

export type AidType =
  | 'food'
  | 'medicine'
  | 'shelter'
  | 'school_kit'
  | 'hygiene_kit'
  | 'cash_transfer'
  | 'nfi'
  | 'water_sanitation'
  | 'protection'
  | 'other';

export const AID_TYPE_LABELS_FR: Record<AidType, string> = {
  food: 'Vivres',
  medicine: 'Médicaments',
  shelter: 'Abri',
  school_kit: 'Kit scolaire',
  hygiene_kit: "Kit d'hygiène",
  cash_transfer: 'Aide financière',
  nfi: 'Articles non alimentaires',
  water_sanitation: 'Eau et assainissement',
  protection: 'Protection',
  other: 'Autre',
};

export type AidStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface AidDistribution extends AuditTimestamps {
  id: UUID;
  disasterEventId?: UUID;
  aidType: AidType;
  description: string;
  quantity: number;
  unit: string;
  status: AidStatus;
  targetPcodes: PCode[];
  plannedDate: ISODate;
  completedDate?: ISODate;
  organizationName: string;
  responsibleAgent: UserPublic;
  totalBeneficiariesTargeted: number;
  totalBeneficiariesServed: number;
}

export interface AidReceipt extends AuditTimestamps {
  id: UUID;
  distributionId: UUID;
  beneficiaryId: UUID;
  qrCodeScanned: string;
  receivedAt: ISODate;
  distributedBy: UserPublic;
  digitalSignature: string;
  quantity: number;
  notes?: string;
  syncStatus: 'pending' | 'synced';
  clientCreatedAt?: ISODate;
}

export interface AidReceiptCreateInput {
  distributionId: UUID;
  beneficiaryId: UUID;
  qrCodeScanned: string;
  quantity: number;
  notes?: string;
}
