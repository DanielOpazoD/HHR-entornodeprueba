import { describe, expect, it } from 'vitest';
import {
  canAccessAppModuleRoute,
  canEditAnyAppModule,
  canOpenTransferDocuments,
  canManageGlobalCensusEmailRecipients,
  canEditMedicalHandoffForDate,
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
  getVisibleAppModules,
  sanitizeAppModuleForRole,
} from '@/shared/access/operationalAccessPolicy';

describe('operationalAccessPolicy', () => {
  it('allows only admin to force day copy override', () => {
    expect(canForceCreateDayCopyOverride('admin')).toBe(true);
    expect(canForceCreateDayCopyOverride('doctor_specialist')).toBe(false);
    expect(canForceCreateDayCopyOverride('nurse_hospital')).toBe(false);
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

  it('centralizes admin, export and transfer-document capabilities by intent', () => {
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

    expect(canOpenTransferDocuments('admin')).toBe(true);
    expect(canOpenTransferDocuments('nurse_hospital')).toBe(true);
    expect(canOpenTransferDocuments('doctor_specialist')).toBe(false);
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

  it('keeps medical handoff edit access bound to specialist current-day policy', () => {
    expect(
      canEditMedicalHandoffForDate({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-03-16',
        todayISO: '2026-03-16',
      })
    ).toBe(true);

    expect(
      canEditMedicalHandoffForDate({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-03-16T00:00:00.000Z',
        todayISO: '2026-03-16',
      })
    ).toBe(true);

    expect(
      canEditMedicalHandoffForDate({
        role: 'doctor_specialist',
        readOnly: false,
        recordDate: '2026-03-15',
        todayISO: '2026-03-16',
      })
    ).toBe(false);
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
