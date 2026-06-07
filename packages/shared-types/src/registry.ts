import type { UUID, ISODate, PCode, ConfidenceLevel, AuditTimestamps } from './common.js';
import type { HazardType } from './alerts.js';
import type { LocationReference } from './geo.js';
import type { UserPublic } from './users.js';

export type VulnerabilityLevel = 'low' | 'medium' | 'high' | 'critical';
export type BeneficiaryStatus = 'pending' | 'under_validation' | 'validated' | 'rejected' | 'duplicate';

export type ValidationStep =
  | 'neighborhood_chief'
  | 'village_chief'
  | 'mayor'
  | 'territory_admin'
  | 'humanitarian_partner';

export const VALIDATION_CHAIN: ValidationStep[] = [
  'neighborhood_chief',
  'village_chief',
  'mayor',
  'territory_admin',
  'humanitarian_partner',
];

export interface HouseholdMember {
  firstName: string;
  lastName: string;
  birthDate?: ISODate;
  gender: 'M' | 'F' | 'other';
  isHeadOfHousehold: boolean;
  hasDisability?: boolean;
  isPregnant?: boolean;
  isUnaccompanied?: boolean;
}

export interface ValidationRecord {
  step: ValidationStep;
  validatedBy: UserPublic;
  validatedAt: ISODate;
  approved: boolean;
  notes?: string;
}

export interface Beneficiary extends AuditTimestamps {
  id: UUID;
  registrationNumber: string;
  qrCodeData: string;
  status: BeneficiaryStatus;
  householdHead: HouseholdMember;
  householdMembers: HouseholdMember[];
  householdSize: number;
  vulnerabilityLevel: VulnerabilityLevel;
  vulnerabilityFactors: string[];
  disasterType: HazardType;
  disasterEventId?: UUID;
  location: LocationReference;
  originLocation?: LocationReference;
  currentLocation?: LocationReference;
  registeredBy: UserPublic;
  registeredAt: ISODate;
  validationChain: ValidationRecord[];
  currentValidationStep: ValidationStep | 'complete';
  duplicateOf?: UUID;
  duplicateConfidence?: ConfidenceLevel;
  notes?: string;
  isSensitive: boolean;
  locationObfuscated: boolean;
  syncStatus: 'pending' | 'synced';
  clientCreatedAt?: ISODate;
}

export interface BeneficiaryCreateInput {
  householdHead: HouseholdMember;
  householdMembers?: HouseholdMember[];
  vulnerabilityFactors?: string[];
  disasterType: HazardType;
  disasterEventId?: UUID;
  location: LocationReference;
  notes?: string;
}

export interface DuplicateCandidate {
  beneficiaryId: UUID;
  candidateId: UUID;
  similarityScore: number;
  matchingFields: string[];
  requiresHumanReview: boolean;
}
