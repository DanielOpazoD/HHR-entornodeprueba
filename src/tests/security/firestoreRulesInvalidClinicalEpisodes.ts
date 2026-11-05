import { describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp } from 'firebase/firestore';
import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

const markPath = 'hospitals/H1/invalidClinicalEpisodes/900001';

const markFor = (uid: string) => ({
  clinicalEpisodeId: '900001',
  censusDate: '2026-11-05',
  bedId: 'NEO2',
  markedAt: serverTimestamp(),
  markedBy: uid,
});

export const registerInvalidClinicalEpisodeRules = ({
  admin,
  nurse,
  doctor,
  editor,
  authed,
  setupDocBypass,
}: FirestoreRulesHarness): void => {
  describe('Invalid Clinical Episodes', () => {
    it('lets census editors mark an episode as not valid, signed by themselves', async () => {
      await assertSucceeds(nurse().doc(markPath).set(markFor('user_nurse')));
      await assertSucceeds(
        admin()
          .doc('hospitals/H1/invalidClinicalEpisodes/900002')
          .set({
            ...markFor('user_admin'),
            clinicalEpisodeId: '900002',
          })
      );
    });

    it('rejects marks from roles that cannot edit the census', async () => {
      await assertFails(doctor().doc(markPath).set(markFor('user_doctor')));
      await assertFails(editor().doc(markPath).set(markFor('user_editor')));
      await assertFails(authed().doc(markPath).set(markFor('user_basic')));
    });

    it('rejects a mark for another episode, another author, a client clock or extra data', async () => {
      await assertFails(
        nurse()
          .doc(markPath)
          .set({ ...markFor('user_nurse'), clinicalEpisodeId: '900003' })
      );
      await assertFails(nurse().doc(markPath).set(markFor('user_admin')));
      await assertFails(
        nurse()
          .doc(markPath)
          .set({ ...markFor('user_nurse'), markedAt: '2026-11-05T12:00:00.000Z' })
      );
      await assertFails(
        nurse()
          .doc(markPath)
          .set({ ...markFor('user_nurse'), patientName: 'Paciente Test' })
      );
    });

    it('keeps the mark immutable; only admin removes it', async () => {
      await setupDocBypass(markPath, {
        clinicalEpisodeId: '900001',
        censusDate: '2026-11-05',
        bedId: 'NEO2',
        markedAt: new Date('2026-11-05T12:00:00.000Z'),
        markedBy: 'user_nurse',
      });

      await assertSucceeds(nurse().doc(markPath).get());
      await assertFails(nurse().doc(markPath).set(markFor('user_nurse')));
      await assertFails(nurse().doc(markPath).update({ bedId: 'NEO1' }));
      await assertFails(nurse().doc(markPath).delete());
      await assertSucceeds(admin().doc(markPath).delete());
    });
  });
};
