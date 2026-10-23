import { afterEach, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
  makeCanonicalEmptyBed,
} from './dailyRecordWriteAuthorityFunctions.test-support';
afterEach(() => {
  delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
});
it.each([false, true])(
  'validates stored specialty audit and preserves clinical snapshot during full-save undo (crib=%s)',
  async nested => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    const base = makeRecord();
    const metadata = {
      schemaVersion: 3,
      episodeId: 'ep-uno',
      decisionId: 'prior-decision',
      recordDate: base.date,
      source: 'manual',
      actorUid: 'synthetic-user',
      decidedAt: '2026-05-13T08:00:00.000Z',
    };
    const patient = {
      ...base.beds.R1,
      specialty: 'Cirugía',
      specialtyAssignment: metadata,
      vitalSigns: { systolic: 120 },
      evaluationScores: { test: 'preserved' },
      neonatalMaternalRut: base.beds.R1.rut,
    };
    const movement = {
      movementDate: base.date,
      time: '12:00',
      id: 'old-discharge',
      bedId: 'R1',
      isNested: nested,
      originalData: patient,
    };
    const parent = { ...base.beds.R1, clinicalEpisodeId: 'mother' };
    const remote = {
      ...base,
      beds: { R1: nested ? parent : makeCanonicalEmptyBed() },
      discharges: [movement],
    };
    const candidate = {
      ...base,
      beds: { R1: nested ? { ...parent, clinicalCrib: patient } : patient },
      discharges: [{ ...movement, deletedAt: '2026-05-13T12:00:00Z' }],
    };
    if (nested) {
      const maternal = {
        ...movement,
        id: 'mother-exit',
        isNested: false,
        originalData: parent,
        deletedAt: '2026-05-13T12:30:00Z',
      };
      Object.assign(remote, { discharges: [...remote.discharges, maternal] });
      Object.assign(candidate, { discharges: [...candidate.discharges, maternal] });
    }
    for (const trusted of [false, true]) {
      const { admin, update, set } = createAdminMock({
        remoteData: remote,
        policyData: { schemaVersion: 2, mode: 'preview', clinicalBatchMode: 'enforced' },
        specialtyAuditData: trusted
          ? {
              recordDate: base.date,
              decisionId: metadata.decisionId,
              episodeId: 'ep-uno',
              value: 'Cirugía',
              metadata,
            }
          : undefined,
      });
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: admin.firestore(),
        Timestamp: admin.firestore.Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      const promise = api.saveDailyRecordWithClinicalAuthority.run(
        { date: base.date, record: candidate, expectedLastUpdated: base.lastUpdated },
        makeContext()
      );
      if (!trusted) {
        await expect(promise).rejects.toThrow(/Unverified specialty provenance/);
        continue;
      }
      await expect(promise).resolves.toMatchObject({ success: true });
      const writes = [...update.mock.calls, ...set.mock.calls].map(call => call[1]);
      expect(writes.some(write => JSON.stringify(write).includes('"systolic":120'))).toBe(true);
      expect(writes.some(write => JSON.stringify(write).includes('"test":"preserved"'))).toBe(true);
    }
  }
);
