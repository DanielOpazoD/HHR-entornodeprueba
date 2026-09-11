import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

const require = createRequire(import.meta.url);
const {
  BACKUP_RESTORE_ORIGIN,
  RAYEN_CLINICAL_FIELDS,
  isAdminBackupRestoreOfMissingDay,
  shouldPreserveRayenClinicalFields,
} = require('../../../functions/lib/dailyRecordClinicalFieldPreservation.js');

const fencedPolicy = { schemaVersion: 2, clinicalBatchMode: 'enforced', mode: 'auto', revision: 7 };

const clinicalPayload = {
  devices: ['VVP#1'],
  deviceDetails: { 'VVP#1': { installationDate: '2026-09-07', note: 'brazo derecho' } },
  deviceInstanceHistory: [{ device: 'VVP#1', installedAt: '2026-09-07T12:00:00.000Z' }],
  evaluationScores: { braden: 18, downton: 2 },
  vitalSigns: { systolic: 118, diastolic: 72, heartRate: 71 },
  vitalSignsHistory: [{ at: '2026-09-09T08:00:00.000Z', systolic: 118 }],
  clinicalSyncCheckpoint: { version: 2, syncedAt: '2026-09-09T08:05:00.000Z' },
};

const makeBackupRecord = () => {
  const base = makeRecord();
  return {
    ...base,
    dateTimestamp: Date.now(),
    beds: { R1: { ...base.beds.R1, ...clinicalPayload } },
  };
};

const runSave = async ({
  remoteData,
  origin,
  role,
}: {
  remoteData?: Record<string, unknown>;
  origin: string;
  role: string;
}) => {
  const mock = createAdminMock({ remoteData, policyData: fencedPolicy });
  const functionsApi = createDailyRecordWriteAuthorityFunctions({
    firestore: mock.admin.firestore(),
    Timestamp: mock.admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });
  const record = makeBackupRecord();
  await functionsApi.saveDailyRecordWithClinicalAuthority.run(
    { date: record.date, mode: 'enforced', origin, record },
    makeContext()
  );
  const persisted = mock.set.mock.calls.at(-1)?.[1] as { beds: Record<string, unknown> };
  return persisted.beds.R1 as Record<string, unknown>;
};

describe('backup restore through the clinical authority fence', () => {
  it('exposes a single origin literal shared with the client contract', () => {
    expect(BACKUP_RESTORE_ORIGIN).toBe('backup_restore');
  });

  it('only recognises an admin restore of a day that no longer exists', () => {
    const missing = { exists: false };
    const existing = { exists: true };
    expect(
      isAdminBackupRestoreOfMissingDay({
        snapshot: missing,
        origin: 'backup_restore',
        role: 'admin',
      })
    ).toBe(true);
    expect(
      isAdminBackupRestoreOfMissingDay({
        snapshot: existing,
        origin: 'backup_restore',
        role: 'admin',
      })
    ).toBe(false);
    expect(
      isAdminBackupRestoreOfMissingDay({ snapshot: missing, origin: 'direct_save', role: 'admin' })
    ).toBe(false);
    expect(
      isAdminBackupRestoreOfMissingDay({
        snapshot: missing,
        origin: 'backup_restore',
        role: 'nurse_hospital',
      })
    ).toBe(false);
  });

  it('keeps the fence whenever the policy is fenced except for the admin restore case', () => {
    const policySnapshot = { exists: true, data: () => fencedPolicy };
    const legacyPolicy = { exists: true, data: () => ({ schemaVersion: 1 }) };
    expect(
      shouldPreserveRayenClinicalFields({
        policySnapshot,
        snapshot: { exists: false },
        origin: 'backup_restore',
        role: 'admin',
      })
    ).toBe(false);
    expect(
      shouldPreserveRayenClinicalFields({
        policySnapshot,
        snapshot: { exists: false },
        origin: 'direct_save',
        role: 'admin',
      })
    ).toBe(true);
    expect(
      shouldPreserveRayenClinicalFields({
        policySnapshot: legacyPolicy,
        snapshot: { exists: false },
        origin: 'direct_save',
        role: 'admin',
      })
    ).toBe(false);
  });

  it('persists every Rayen clinical field when an admin restores a deleted day', async () => {
    const bed = await runSave({ remoteData: undefined, origin: 'backup_restore', role: 'admin' });

    RAYEN_CLINICAL_FIELDS.forEach((field: string) => {
      expect(bed[field], field).toEqual(clinicalPayload[field as keyof typeof clinicalPayload]);
    });
  });

  it('still strips the fields for a blank or copied day created without restore intent', async () => {
    const bed = await runSave({ remoteData: undefined, origin: 'direct_save', role: 'admin' });

    RAYEN_CLINICAL_FIELDS.forEach((field: string) => {
      expect(bed, field).not.toHaveProperty(field);
    });
    expect(bed.patientName).toBe('Paciente Uno');
  });

  it('still strips the fields when a nurse creates the day, even with restore intent', async () => {
    const bed = await runSave({
      remoteData: undefined,
      origin: 'backup_restore',
      role: 'nurse_hospital',
    });

    RAYEN_CLINICAL_FIELDS.forEach((field: string) => {
      expect(bed, field).not.toHaveProperty(field);
    });
  });

  it('keeps the remote clinical truth when restoring over a day that still exists', async () => {
    const remote: Record<string, unknown> = makeBackupRecord();
    remote.beds = {
      R1: {
        ...(remote.beds as Record<string, Record<string, unknown>>).R1,
        vitalSigns: { systolic: 140 },
        devices: ['VVP#2'],
      },
    };
    const bed = await runSave({ remoteData: remote, origin: 'backup_restore', role: 'admin' });

    expect(bed.vitalSigns).toEqual({ systolic: 140 });
    expect(bed.devices).toEqual(['VVP#2']);
  });
});
