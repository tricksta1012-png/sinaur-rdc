import type { UUID, ISODate, PCode, AuditTimestamps } from './common.js';

export type UserRole =
  | 'citizen'
  | 'field_agent'
  | 'local_validator'
  | 'territory_admin'
  | 'humanitarian_partner'
  | 'national_decision_maker'
  | 'system_admin';

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  citizen: 0,
  field_agent: 1,
  local_validator: 2,
  territory_admin: 3,
  humanitarian_partner: 3,
  national_decision_maker: 4,
  system_admin: 99,
};

export const ROLE_LABELS_FR: Record<UserRole, string> = {
  citizen: 'Citoyen',
  field_agent: 'Agent terrain',
  local_validator: 'Validateur local',
  territory_admin: 'Administrateur de territoire',
  humanitarian_partner: 'Partenaire humanitaire',
  national_decision_maker: 'Décideur national',
  system_admin: 'Administrateur système',
};

export interface UserPermissions {
  canReportIncident: boolean;
  canValidateReports: boolean;
  canManageRegistry: boolean;
  canDistributeAid: boolean;
  canViewNationalDashboard: boolean;
  canManageAlerts: boolean;
  canExportData: boolean;
  canViewSensitiveData: boolean;
  canManageUsers: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  citizen: {
    canReportIncident: true,
    canValidateReports: false,
    canManageRegistry: false,
    canDistributeAid: false,
    canViewNationalDashboard: false,
    canManageAlerts: false,
    canExportData: false,
    canViewSensitiveData: false,
    canManageUsers: false,
  },
  field_agent: {
    canReportIncident: true,
    canValidateReports: true,
    canManageRegistry: true,
    canDistributeAid: true,
    canViewNationalDashboard: false,
    canManageAlerts: false,
    canExportData: false,
    canViewSensitiveData: true,
    canManageUsers: false,
  },
  local_validator: {
    canReportIncident: true,
    canValidateReports: true,
    canManageRegistry: true,
    canDistributeAid: false,
    canViewNationalDashboard: false,
    canManageAlerts: false,
    canExportData: false,
    canViewSensitiveData: true,
    canManageUsers: false,
  },
  territory_admin: {
    canReportIncident: true,
    canValidateReports: true,
    canManageRegistry: true,
    canDistributeAid: true,
    canViewNationalDashboard: true,
    canManageAlerts: true,
    canExportData: true,
    canViewSensitiveData: true,
    canManageUsers: false,
  },
  humanitarian_partner: {
    canReportIncident: true,
    canValidateReports: true,
    canManageRegistry: true,
    canDistributeAid: true,
    canViewNationalDashboard: true,
    canManageAlerts: false,
    canExportData: true,
    canViewSensitiveData: true,
    canManageUsers: false,
  },
  national_decision_maker: {
    canReportIncident: true,
    canValidateReports: true,
    canManageRegistry: true,
    canDistributeAid: true,
    canViewNationalDashboard: true,
    canManageAlerts: true,
    canExportData: true,
    canViewSensitiveData: true,
    canManageUsers: false,
  },
  system_admin: {
    canReportIncident: true,
    canValidateReports: true,
    canManageRegistry: true,
    canDistributeAid: true,
    canViewNationalDashboard: true,
    canManageAlerts: true,
    canExportData: true,
    canViewSensitiveData: true,
    canManageUsers: true,
  },
};

export interface User extends AuditTimestamps {
  id: UUID;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: UserRole;
  geographicScopePcodes: PCode[];
  isActive: boolean;
  isPseudonymous: boolean;
  lastLoginAt: ISODate | null;
  fcmTokens: string[];
}

export interface UserPublic {
  id: UUID;
  displayName: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: UUID;
  role: UserRole;
  scope: PCode[];
  iat: number;
  exp: number;
}
