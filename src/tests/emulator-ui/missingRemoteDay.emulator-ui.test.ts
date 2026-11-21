// Retry and denial behaviour of direct and atomic writes on a day the server does not have. The
// role × write-kind matrix lives in missingRemoteDay{Production,Absent}Policy; all three share
// missingRemoteDay.test-support.ts and each uses its own emulator project.
import { expect, it } from 'vitest';
import {
  baseRecord,
  date,
  dayPath,
  describeMissingRemoteDay,
  transport,
} from './missingRemoteDay.test-support';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

describeMissingRemoteDay('demo-hhr-e8e', h => {
  const { calls, actor, patch } = h;
  // Waiting cannot make a missing day, a denial or a malformed write succeed; only a network
  // failure is retried with backoff. The denial still gets its one role refresh and retry.
  for (const [code, attempts] of [
    ['not-found', 1],
    ['invalid-argument', 1],
    ['permission-denied', 2],
    ['unavailable', 4],
  ] as const) {
    it(`a ${code} direct write fails after ${attempts} attempt(s) and stays queued`, async () => {
      h.clients.B = {
        uid: 'synthetic-B',
        role: 'nurse_hospital',
        db: h.env
          .authenticatedContext('synthetic-B', {
            email: 'synthetic@example.invalid',
            role: 'nurse_hospital',
          })
          .firestore(),
      };
      transport.reject = code;
      await expect(patch('B', { handoffNovedadesDayShift: 'EDITADO' })).rejects.toMatchObject({
        code,
      });
      expect(transport.attempts).toBe(attempts);
      expect((await h.admin.doc(dayPath).get()).data()).toBeUndefined();
      if (code === 'unavailable') return;

      transport.attempts = 0;
      await hospitalDB.dailyRecords.put(baseRecord());
      const result = await actor('B', () =>
        updatePartialDetailed(
          date,
          { handoffNovedadesDayShift: 'EDITADO' },
          { authoringSession: captureAuthoringSession(), baseRecord: baseRecord() }
        )
      );
      expect(transport.attempts).toBe(attempts);
      expect(result).toMatchObject({ savedHere: true, state: 'held', reason: 'needs_review' });
      expect(await hospitalDB.syncQueue.toArray()).toMatchObject([
        { status: 'PENDING', payload: { date, handoffNovedadesDayShift: 'EDITADO' } },
      ]);
    });
  }
  it('a write the rules deny is not retried with backoff on the atomic path', async () => {
    h.clients.B = {
      uid: 'synthetic-B',
      role: 'doctor_urgency',
      db: h.env
        .authenticatedContext('synthetic-B', {
          email: 'synthetic@example.invalid',
          role: 'doctor_urgency',
        })
        .firestore(),
    };
    await h.admin.doc(dayPath).set(baseRecord());

    await expect(patch('B', { nursesDayShift: ['ENFERMERA NUEVA', ''] })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    // One attempt, then one more after the role refresh: the recovery that can succeed.
    expect(calls.transaction).toBe(2);
    expect((await h.admin.doc(dayPath).get()).data()?.nursesDayShift).toEqual(
      baseRecord().nursesDayShift
    );
  });
  // Staffing and plain day fields both commit through the versioned transaction.
  it.each<[string, DailyRecordPatch]>([
    ['staffing', { nursesDayShift: ['ENFERMERA NUEVA', ''] }],
    ['handoff novedades', { handoffNovedadesDayShift: 'NOVEDAD NUEVA' }],
  ])(
    '%s: a transient SDK error that outlasts the transaction retries is still saved',
    async (_label, edit) => {
      h.clients.B = {
        uid: 'synthetic-B',
        role: 'nurse_hospital',
        db: h.env
          .authenticatedContext('synthetic-B', {
            email: 'synthetic@example.invalid',
            role: 'nurse_hospital',
          })
          .firestore(),
      };
      await h.admin.doc(dayPath).set(baseRecord());
      // The SDK makes five attempts of its own; only the outer retry reaches the sixth.
      transport.transactionFailures = 5;
      await patch('B', edit);
      expect(transport.transactionAttempts).toBe(6);
      expect((await h.admin.doc(dayPath).get()).data()).toMatchObject(edit);
    }
  );
});
