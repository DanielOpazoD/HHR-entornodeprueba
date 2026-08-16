import type { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/types/authRoleTypes';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';

export interface RoleAccessDefinition {
  role: UserRole;
  label: string;
  badgeLabel: string;
  badgeClassName: string;
  generalLoginAllowed: boolean;
  assignableInRoleManagement: boolean;
  modules: ModuleType[];
  canEdit: ModuleType[];
  censusAccessProfile: CensusAccessProfile;
  specialistRestrictedMedicalAccess: boolean;
  canReadClinicalDocuments: boolean;
  canEditClinicalDocumentDrafts: boolean;
}

const ROLE_ACCESS_MATRIX = {
  admin: {
    role: 'admin',
    label: 'Administrador Total',
    badgeLabel: 'ADMIN',
    badgeClassName: 'bg-indigo-600 text-white border-indigo-700',
    generalLoginAllowed: true,
    assignableInRoleManagement: true,
    modules: [
      'CENSUS',
      'ANALYTICS',
      'CUDYR',
      'NURSING_HANDOFF',
      'MEDICAL_HANDOFF',
      'AUDIT',
      'WHATSAPP',
      'PATIENT_MASTER_INDEX',
      'DATA_MAINTENANCE',
      'DIAGNOSTICS',
      'FUNCTIONS_TELEMETRY',
      'CONFIGURATION',
      'DATA',
      'COMMUNICATIONS',
      'BACKUP_FILES',
      'ROLE_MANAGEMENT',
      'REMINDERS',
    ],
    canEdit: [
      'CENSUS',
      'ANALYTICS',
      'CUDYR',
      'NURSING_HANDOFF',
      'MEDICAL_HANDOFF',
      'AUDIT',
      'WHATSAPP',
      'PATIENT_MASTER_INDEX',
      'DATA_MAINTENANCE',
      'DIAGNOSTICS',
      'FUNCTIONS_TELEMETRY',
      'CONFIGURATION',
      'DATA',
      'COMMUNICATIONS',
      'BACKUP_FILES',
      'ROLE_MANAGEMENT',
      'REMINDERS',
    ],
    censusAccessProfile: 'default',
    specialistRestrictedMedicalAccess: false,
    canReadClinicalDocuments: true,
    canEditClinicalDocumentDrafts: true,
  },
  nurse_hospital: {
    role: 'nurse_hospital',
    label: 'Enfermería Hospitalaria',
    badgeLabel: 'ENFERMERÍA',
    badgeClassName: 'bg-emerald-500 text-white border-emerald-600',
    generalLoginAllowed: true,
    assignableInRoleManagement: true,
    modules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'],
    canEdit: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF'],
    censusAccessProfile: 'default',
    specialistRestrictedMedicalAccess: false,
    canReadClinicalDocuments: true,
    canEditClinicalDocumentDrafts: false,
  },
  doctor_urgency: {
    role: 'doctor_urgency',
    label: 'Médico de Urgencia',
    badgeLabel: 'URGENCIA',
    badgeClassName: 'bg-sky-500 text-white border-sky-600',
    generalLoginAllowed: true,
    assignableInRoleManagement: true,
    modules: ['CENSUS', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'],
    canEdit: ['MEDICAL_HANDOFF'],
    censusAccessProfile: 'default',
    specialistRestrictedMedicalAccess: false,
    canReadClinicalDocuments: true,
    canEditClinicalDocumentDrafts: true,
  },
  doctor_specialist: {
    role: 'doctor_specialist',
    label: 'Especialista (Censo abreviado + Entrega Médica)',
    badgeLabel: 'ESPECIALISTA LIMITADO',
    badgeClassName: 'bg-violet-500 text-white border-violet-600',
    generalLoginAllowed: true,
    assignableInRoleManagement: true,
    modules: ['CENSUS', 'MEDICAL_HANDOFF'],
    canEdit: ['MEDICAL_HANDOFF'],
    censusAccessProfile: 'specialist',
    specialistRestrictedMedicalAccess: true,
    canReadClinicalDocuments: true,
    canEditClinicalDocumentDrafts: true,
  },
  viewer: {
    role: 'viewer',
    label: 'Invitado (Solo Lectura)',
    badgeLabel: 'INVITADO',
    badgeClassName: 'bg-slate-400 text-white border-slate-500',
    generalLoginAllowed: true,
    assignableInRoleManagement: true,
    modules: ['CENSUS'],
    canEdit: [],
    censusAccessProfile: 'default',
    specialistRestrictedMedicalAccess: false,
    canReadClinicalDocuments: false,
    canEditClinicalDocumentDrafts: false,
  },
  editor: {
    role: 'editor',
    label: 'Editor legado',
    badgeLabel: 'EDITOR LEGADO',
    badgeClassName: 'bg-slate-400 text-white border-slate-500',
    generalLoginAllowed: true,
    assignableInRoleManagement: false,
    modules: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'],
    canEdit: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF'],
    censusAccessProfile: 'default',
    specialistRestrictedMedicalAccess: false,
    canReadClinicalDocuments: true,
    canEditClinicalDocumentDrafts: false,
  },
} satisfies Record<UserRole, RoleAccessDefinition>;

export type ManagedUserRole = Extract<
  UserRole,
  'admin' | 'nurse_hospital' | 'doctor_urgency' | 'doctor_specialist' | 'viewer'
>;

export const DEFAULT_ROLE_ACCESS = ROLE_ACCESS_MATRIX.viewer;
export const GENERAL_LOGIN_ROLES = Object.values(ROLE_ACCESS_MATRIX)
  .filter(definition => definition.generalLoginAllowed)
  .map(definition => definition.role) as UserRole[];
export const MANAGED_ROLE_OPTIONS = Object.values(ROLE_ACCESS_MATRIX).filter(
  definition => definition.assignableInRoleManagement
);

export const resolveRoleAccess = (role?: UserRole | string): RoleAccessDefinition =>
  ROLE_ACCESS_MATRIX[(role as UserRole) ?? 'viewer'] ?? DEFAULT_ROLE_ACCESS;

export const isGeneralLoginRole = (role?: UserRole | string): role is UserRole =>
  GENERAL_LOGIN_ROLES.some(loginRole => loginRole === role);

export const isManagedUserRole = (role?: UserRole | string): role is ManagedUserRole =>
  MANAGED_ROLE_OPTIONS.some(option => option.role === role);

export const getManagedRoleOptions = (): RoleAccessDefinition[] => MANAGED_ROLE_OPTIONS;
