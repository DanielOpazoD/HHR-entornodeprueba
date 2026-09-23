import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { createDailyRecordWriteAuthorityFunctions, makeRecord, makeContext } from
  '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const runEmulatorTests = process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;
const describeEmulator = runEmulatorTests ? describe : describe.skip;

describeEmulator('specialty decision with real Firestore transactions', () => {
  let environment: RulesTestEnvironment;
  const date = '2026-09-23';
  const recordPath = `hospitals/hanga_roa/dailyRecords/${date}`;

  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    const emulatorConfig = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-specialty-decision-test',
      firestore: { rules, host: emulatorConfig.host, port: emulatorConfig.port },
    });
  });

  afterAll(async () => { await environment?.cleanup(); });

  it('commits exactly one decision and audit; rejects a competing stale acceptance', async () => {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const remote = { ...makeRecord(), date, meta: { revision: 2 },
        beds: { R1: { ...makeRecord().beds.R1, specialty: '' } } };
      await db.doc(recordPath).set(remote);
      const api = createDailyRecordWriteAuthorityFunctions({
        firestore: db, Timestamp,
        resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
      });
      const auth = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
      process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
      try {
        const payload = (value: string, mutationId: string) => ({
          date, patch: { 'beds.R1.specialty': value },
          syncContract: { mutationId, baseRevision: 2, changedPaths: ['beds.R1.specialty'] },
          specialtyIntent: { kind: 'manual', bedId: 'R1', target: 'bed',
            episodeId: 'ep-uno', value, expectedDecisionId: null },
        });
        const results = await Promise.allSettled([
          api.patchDailyRecordWithClinicalAuthority.run(payload('Cirugía', 'first-decision'), auth),
          api.patchDailyRecordWithClinicalAuthority.run(payload('Pediatría', 'second-decision'), auth),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const snapshot = await db.doc(recordPath).get();
        const assigned = snapshot.data()?.beds.R1.specialty;
        expect(['Cirugía', 'Pediatría']).toContain(assigned);
        expect(snapshot.data()?.beds.R1.specialtyAssignment.source).toBe('manual');
        const audits = await db.doc(recordPath).collection('specialtyDecisions').get();
        expect(audits.size).toBe(1);
        expect(audits.docs[0].data().value).toBe(assigned);
      } finally {
        delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
      }
    });
  });
});
