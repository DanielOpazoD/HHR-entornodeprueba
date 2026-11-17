// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModuleType } from '@/constants/navigationConfig';
import type { UserRole } from '@/types/authRoleTypes';
import {
  canAccessAppModuleRoute,
  canAccessAuditSensitivePanelsForRole,
  canAccessAuditViewForRole,
  canCorrectCudyrDischarge,
  canDeleteTodayDailyRecord,
  canEditAppModule,
  canEditCudyrForDate,
  canExportAuditDataForRole,
  isAdminAppRole,
  canEditAnyAppModule,
  canManageGlobalCensusEmailRecipients,
  canManageClinicalConflictCenter,
  canForceCreateDayCopyOverride,
  canOpenClinicalDocumentsFromCensus,
  canResetOrDeleteDailyRecord,
  canTriggerCensusExports,
  canUseCensusUtilityActions,
  canUseAdminMaintenanceActions,
  canVerifyPassiveBackupForRole,
  canVerifyArchiveStatusForModule,
  canViewOrManageBackupFiles,
  canViewPatientHistoryFromRestrictedProfiles,
  getDefaultAppModuleForRole,
  getRoleDisplayLabel,
  getVisibleAppModules,
  sanitizeAppModuleForRole,
} from '@/shared/access/operationalAccessPolicy';

describe('operationalAccessPolicy', () => {
  it('allows only admin to force day copy override', () => {
    expect(canForceCreateDayCopyOverride('admin')).toBe(true);
    expect(canForceCreateDayCopyOverride('doctor_specialist')).toBe(false);
    expect(canForceCreateDayCopyOverride('nurse_hospital')).toBe(false);
  });

  it('limits clinical conflict center access to admin users', () => {
    expect(canManageClinicalConflictCenter('admin')).toBe(true);
    expect(canManageClinicalConflictCenter('nurse_hospital')).toBe(false);
    expect(canManageClinicalConflictCenter('editor')).toBe(false);
    expect(canManageClinicalConflictCenter('doctor_specialist')).toBe(false);
    expect(canManageClinicalConflictCenter('viewer')).toBe(false);
    expect(canManageClinicalConflictCenter(undefined)).toBe(false);
  });

  it('allows archive verification only for editable census and nursing handoff modules', () => {
    expect(canVerifyArchiveStatusForModule('admin', 'CENSUS')).toBe(true);
    expect(canVerifyArchiveStatusForModule('nurse_hospital', 'NURSING_HANDOFF')).toBe(true);
    expect(canVerifyArchiveStatusForModule('doctor_specialist', 'CENSUS')).toBe(false);
    expect(canVerifyArchiveStatusForModule('doctor_specialist', 'MEDICAL_HANDOFF')).toBe(false);
    expect(canVerifyPassiveBackupForRole('admin', 'CENSUS')).toBe(true);
    expect(canViewOrManageBackupFiles('nurse_hospital')).toBe(true);
    expect(canViewOrManageBackupFiles('doctor_specialist')).toBe(false);
  });

  it('centralizes admin and export capabilities by intent', () => {
    expect(canUseAdminMaintenanceActions('admin')).toBe(true);
    expect(canUseAdminMaintenanceActions('nurse_hospital')).toBe(false);
    expect(canEditAnyAppModule('admin')).toBe(true);
    expect(canEditAnyAppModule('viewer')).toBe(false);
    expect(canManageGlobalCensusEmailRecipients({ role: 'admin', userId: 'u-1' })).toBe(true);
    expect(canManageGlobalCensusEmailRecipients({ role: 'nurse_hospital', userId: 'u-1' })).toBe(
      true
    );
    expect(canManageGlobalCensusEmailRecipients({ role: 'doctor_specialist', userId: 'u-1' })).toBe(
      false
    );
    expect(canManageGlobalCensusEmailRecipients({ role: 'editor', userId: null })).toBe(false);

    expect(canTriggerCensusExports({ role: 'admin', accessProfile: 'default' })).toBe(true);
    expect(
      canTriggerCensusExports({ role: 'doctor_specialist', accessProfile: 'specialist' })
    ).toBe(false);

    expect(
      canAccessAppModuleRoute({
        role: 'admin',
        module: 'DATA_MAINTENANCE',
        visibleModules: ['DATA_MAINTENANCE'],
      })
    ).toBe(true);
    expect(
      canAccessAppModuleRoute({
        role: 'nurse_hospital',
        module: 'DATA_MAINTENANCE',
        visibleModules: ['DATA_MAINTENANCE'],
      })
    ).toBe(false);
  });

  it('exposes a canonical facade for visible modules and module sanitization', () => {
    expect(getVisibleAppModules('doctor_specialist')).toEqual(['CENSUS', 'MEDICAL_HANDOFF']);
    expect(getDefaultAppModuleForRole('doctor_specialist')).toBe('CENSUS');
    expect(sanitizeAppModuleForRole('doctor_specialist', 'AUDIT')).toBe('CENSUS');
    expect(sanitizeAppModuleForRole('doctor_specialist', 'ANALYTICS')).toBe('CENSUS');
    expect(sanitizeAppModuleForRole('admin', 'AUDIT')).toBe('AUDIT');
    expect(sanitizeAppModuleForRole('admin', 'ANALYTICS')).toBe('ANALYTICS');
  });

  it('resolves census utility actions, clinical document access and reset permissions by intent', () => {
    expect(canUseCensusUtilityActions({ readOnly: false, accessProfile: 'default' })).toBe(true);
    expect(canUseCensusUtilityActions({ readOnly: false, accessProfile: 'specialist' })).toBe(
      false
    );

    expect(
      canOpenClinicalDocumentsFromCensus({
        role: 'doctor_specialist',
        isBlocked: false,
        isEmpty: false,
        hasPatientName: true,
      })
    ).toBe(true);

    expect(
      canResetOrDeleteDailyRecord({
        role: 'nurse_hospital',
        isToday: true,
      })
    ).toBe(true);
    expect(
      canResetOrDeleteDailyRecord({
        role: 'nurse_hospital',
        isToday: false,
      })
    ).toBe(false);

    expect(
      canViewPatientHistoryFromRestrictedProfiles({
        accessProfile: 'default',
        hasRut: true,
      })
    ).toBe(true);
    expect(
      canViewPatientHistoryFromRestrictedProfiles({
        accessProfile: 'specialist',
        hasRut: true,
      })
    ).toBe(false);
  });
});

describe('role × permission truth table', () => {
  const knownRoles: UserRole[] = [
    'admin',
    'nurse_hospital',
    'doctor_urgency',
    'doctor_specialist',
    'viewer',
    'editor',
  ];
  // Free text a stored profile could still carry: it must keep falling to the default access.
  const freeTextRoles = ['hacker', '', 'ADMIN', ' admin'];
  const roles = [...knownRoles, undefined, ...freeTextRoles];
  const modules: ModuleType[] = [
    'CENSUS',
    'ANALYTICS',
    'CUDYR',
    'NURSING_HANDOFF',
    'MEDICAL_HANDOFF',
    'AUDIT',
    'WHATSAPP',
    'BACKUP_FILES',
    'PATIENT_MASTER_INDEX',
    'DATA_MAINTENANCE',
    'DIAGNOSTICS',
    'FUNCTIONS_TELEMETRY',
    'CONFIGURATION',
    'DATA',
    'COMMUNICATIONS',
    'ROLE_MANAGEMENT',
    'REMINDERS',
    'AUDIT_DOCUMENTS',
    'ADMISSION_AUDIT',
  ];
  const flag = (value: boolean): string => (value ? '1' : '0');
  const rowFor = (role: string | undefined) => ({
    visible: getVisibleAppModules(role).join(','),
    defaultModule: getDefaultAppModuleForRole(role),
    editable: modules.filter(module => canEditAppModule(role, module)).join(','),
    routes: modules.filter(module => canAccessAppModuleRoute({ role, module })).join(','),
    sanitizedAudit: sanitizeAppModuleForRole(role, 'AUDIT'),
    archiveVerify: ['CENSUS', 'CUDYR', 'NURSING_HANDOFF', 'MEDICAL_HANDOFF', 'other']
      .map(module => flag(canVerifyArchiveStatusForModule(role, module)))
      .join(''),
    flags: [
      canEditAnyAppModule(role),
      canForceCreateDayCopyOverride(role),
      canViewOrManageBackupFiles(role),
      canManageGlobalCensusEmailRecipients({ role, userId: 'user-1' }),
      canUseAdminMaintenanceActions(role),
      canTriggerCensusExports({ role }),
      canEditCudyrForDate({
        role,
        readOnly: false,
        recordDate: '2026-11-17',
        todayISO: '2026-11-17',
      }),
      canEditCudyrForDate({
        role,
        readOnly: false,
        recordDate: '2026-11-15',
        todayISO: '2026-11-17',
      }),
      canCorrectCudyrDischarge({ role, readOnly: false }),
      canOpenClinicalDocumentsFromCensus({
        role,
        isBlocked: false,
        isEmpty: false,
        hasPatientName: true,
      }),
      canResetOrDeleteDailyRecord({ role, isToday: true }),
      canResetOrDeleteDailyRecord({ role, isToday: false }),
      canDeleteTodayDailyRecord(role),
      isAdminAppRole(role),
      canAccessAuditViewForRole(role),
      canAccessAuditSensitivePanelsForRole(role),
      canManageClinicalConflictCenter(role),
      canExportAuditDataForRole(role),
    ]
      .map(flag)
      .join(''),
  });

  it('keeps every access decision for known, missing and free-text roles', () => {
    expect(Object.fromEntries(roles.map(role => [String(role), rowFor(role)])))
      .toMatchInlineSnapshot(`
      {
        "": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "",
          "flags": "000000000000000000",
          "routes": "CENSUS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS",
        },
        " admin": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "",
          "flags": "000000000000000000",
          "routes": "CENSUS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS",
        },
        "ADMIN": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "",
          "flags": "000000000000000000",
          "routes": "CENSUS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS",
        },
        "admin": {
          "archiveVerify": "10100",
          "defaultModule": "CENSUS",
          "editable": "CENSUS,ANALYTICS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF,AUDIT,WHATSAPP,BACKUP_FILES,PATIENT_MASTER_INDEX,DATA_MAINTENANCE,DIAGNOSTICS,FUNCTIONS_TELEMETRY,CONFIGURATION,DATA,COMMUNICATIONS,ROLE_MANAGEMENT,REMINDERS,AUDIT_DOCUMENTS,ADMISSION_AUDIT",
          "flags": "111111111111111111",
          "routes": "CENSUS,ANALYTICS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF,AUDIT,WHATSAPP,BACKUP_FILES,PATIENT_MASTER_INDEX,DATA_MAINTENANCE,DIAGNOSTICS,FUNCTIONS_TELEMETRY,CONFIGURATION,DATA,COMMUNICATIONS,ROLE_MANAGEMENT,REMINDERS,AUDIT_DOCUMENTS,ADMISSION_AUDIT",
          "sanitizedAudit": "AUDIT",
          "visible": "CENSUS,ANALYTICS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF,AUDIT,WHATSAPP,PATIENT_MASTER_INDEX,DATA_MAINTENANCE,DIAGNOSTICS,FUNCTIONS_TELEMETRY,CONFIGURATION,DATA,COMMUNICATIONS,BACKUP_FILES,ROLE_MANAGEMENT,REMINDERS,AUDIT_DOCUMENTS,ADMISSION_AUDIT",
        },
        "doctor_specialist": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "MEDICAL_HANDOFF",
          "flags": "100000000100000000",
          "routes": "CENSUS,MEDICAL_HANDOFF",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS,MEDICAL_HANDOFF",
        },
        "doctor_urgency": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "MEDICAL_HANDOFF",
          "flags": "100000000100000001",
          "routes": "CENSUS,NURSING_HANDOFF,MEDICAL_HANDOFF",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS,NURSING_HANDOFF,MEDICAL_HANDOFF",
        },
        "editor": {
          "archiveVerify": "10100",
          "defaultModule": "CENSUS",
          "editable": "CENSUS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF",
          "flags": "101101000100000000",
          "routes": "CENSUS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF",
        },
        "hacker": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "",
          "flags": "000000000000000000",
          "routes": "CENSUS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS",
        },
        "nurse_hospital": {
          "archiveVerify": "10100",
          "defaultModule": "CENSUS",
          "editable": "CENSUS,CUDYR,NURSING_HANDOFF",
          "flags": "101101101110100001",
          "routes": "CENSUS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF,AUDIT_DOCUMENTS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS,CUDYR,NURSING_HANDOFF,MEDICAL_HANDOFF,AUDIT_DOCUMENTS",
        },
        "undefined": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "",
          "flags": "000000000000000000",
          "routes": "CENSUS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS",
        },
        "viewer": {
          "archiveVerify": "00000",
          "defaultModule": "CENSUS",
          "editable": "",
          "flags": "000000000000000000",
          "routes": "CENSUS",
          "sanitizedAudit": "CENSUS",
          "visible": "CENSUS",
        },
      }
    `);
  });

  it('keeps the role label of every known role and of no role', () => {
    expect([...knownRoles, undefined].map(role => `${role}: ${getRoleDisplayLabel(role)}`))
      .toMatchInlineSnapshot(`
      [
        "admin: Administrador",
        "nurse_hospital: Enfermería Hospitalizados",
        "doctor_urgency: Médico de Urgencia",
        "doctor_specialist: Especialista",
        "viewer: Visualizador de Censo",
        "editor: Invitado",
        "undefined: Invitado",
      ]
    `);
  });
});
