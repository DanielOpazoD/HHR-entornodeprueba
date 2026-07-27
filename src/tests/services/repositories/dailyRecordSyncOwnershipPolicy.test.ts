import { describe, expect, it } from 'vitest';
import {
  PATIENT_SYNC_OWNERSHIP_FIELDS,
  resolveDailyRecordSyncOwnership,
  SYNC_OWNERSHIP_POLICY_VERSION,
} from '@/services/repositories/dailyRecordSyncOwnershipPolicy';

describe('dailyRecordSyncOwnershipPolicy', () => {
  it('classifies patient fields through a central ownership matrix', () => {
    expect(SYNC_OWNERSHIP_POLICY_VERSION).toBe('2026-05-daily-record-v2');
    expect(resolveDailyRecordSyncOwnership('beds.R1.patientName')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.rut')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.pathology')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.specialty')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.status')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.upcChecklist')).toBe('remoteCanonical');
    expect(resolveDailyRecordSyncOwnership('beds.R1.bedMode')).toBe('adminRemote');
    expect(resolveDailyRecordSyncOwnership('beds.R1.location')).toBe('adminRemote');
    expect(resolveDailyRecordSyncOwnership('beds.R1.clinicalCrib')).toBe('movementInvariant');
    expect(resolveDailyRecordSyncOwnership('beds.R1.clinicalSyncCheckpoint')).toBe('mergeById');
    expect(resolveDailyRecordSyncOwnership('beds.R1.handoffNote')).toBe('localNarrative');
    expect(resolveDailyRecordSyncOwnership('beds.R1.medicalHandoffNote')).toBe('localNarrative');
    expect(resolveDailyRecordSyncOwnership('discharges')).toBe('mergeById');
    expect(resolveDailyRecordSyncOwnership('transfers')).toBe('mergeById');
    expect(resolveDailyRecordSyncOwnership('beds.R1.unknown')).toBe('default');
  });

  it('does not leave known patient fields without an explicit sync ownership', () => {
    expect(PATIENT_SYNC_OWNERSHIP_FIELDS.length).toBeGreaterThan(40);

    PATIENT_SYNC_OWNERSHIP_FIELDS.forEach(field => {
      expect(resolveDailyRecordSyncOwnership(`beds.R1.${field}`)).not.toBe('default');
    });
  });
});
