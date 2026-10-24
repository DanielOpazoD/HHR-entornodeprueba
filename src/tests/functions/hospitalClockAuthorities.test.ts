// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

const require = createRequire(import.meta.url);
const {
  assertRayenClinicalBatchAuthority,
} = require('../../../functions/lib/rayenClinicalBatchAuthority.js');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-25T02:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('hospital-day authority at 02:00 UTC', () => {
  it('keeps the nurse calendar fallback open for the previous hospital day', async () => {
    const remote = { ...makeRecord(), date: '2026-10-23' };
    const { admin, update, docRef } = createAdminMock({
      remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
    });
    const api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });
    await api.patchDailyRecordWithClinicalAuthority.run(
      {
        date: remote.date,
        mode: 'enforced',
        patch: { 'beds.R1.patientName': 'Paciente Sintético' },
      },
      makeContext()
    );
    expect(update).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({
        'beds.R1.patientName': 'Paciente Sintético',
      })
    );
  });

  it('accepts legacy Rayen authority only for the current hospital day', () => {
    const input = (date: string) => ({
      policySnapshot: {
        exists: true,
        data: () => ({ schemaVersion: 1, mode: 'auto', revision: 1 }),
      },
      record: {
        date,
        rayenSyncHistory: [{ status: 'applied', policy: { mode: 'auto', revision: 1 } }],
      },
      payload: { date, authorityDate: date, legacyAuthorityInference: true },
    });
    expect(assertRayenClinicalBatchAuthority(input('2026-10-24'))).toEqual({
      policyRevision: 1,
      sourceDate: '2026-10-24',
    });
    expect(() => assertRayenClinicalBatchAuthority(input('2026-10-25'))).toThrow();
  });
});
