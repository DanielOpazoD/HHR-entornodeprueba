import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteField } from 'firebase/firestore';
import { describe, it } from 'vitest';

import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

/**
 * Split days (phase 1a): episode documents are server-written like specialtyDecisions, and no
 * client update may touch the day marker or move a marked day's revision back. Synthetic data.
 */
export function registerClinicalDerivedRules(harness: FirestoreRulesHarness): void {
  const { admin, nurse, doctor, editor, authed, unauth, unauthorizedAuthed } = harness;
  const { NOW_MS, CURRENT_RECORD_DATE, setupDocBypass } = harness;
  const recordPath = `hospitals/H1/dailyRecords/${CURRENT_RECORD_DATE}`;
  const episodesPath = `${recordPath}/clinicalDerived`;
  const episodePath = `${episodesPath}/ep_synthetic_a`;
  const marker = { version: 1, generation: 'gen_synthetic_a' };
  const episode = {
    schemaVersion: 1,
    date: CURRENT_RECORD_DATE,
    clinicalEpisodeId: 'ep_synthetic_a',
    layoutGeneration: marker.generation,
    dayRevision: 5,
    vitalSignsHistory: null,
  };
  const baseDay = {
    date: CURRENT_RECORD_DATE,
    dateTimestamp: NOW_MS,
    nursesDayShift: ['Enfermera Sintética'],
    beds: { R1: { bedId: 'R1', clinicalEpisodeId: 'ep_synthetic_a' } },
    meta: { revision: 5 },
  };
  const markedDay = { ...baseDay, clinicalDerivedLayout: marker };
  const { meta: _meta, ...withoutMeta } = markedDay;

  describe('Split-day clinicalDerived episode documents', () => {
    it('clinical roles read episode documents; outsiders and anonymous users do not', async () => {
      await setupDocBypass(episodePath, episode);
      for (const db of [admin, nurse, doctor, editor, authed]) {
        await assertSucceeds(db().doc(episodePath).get());
        await assertSucceeds(db().collection(episodesPath).get());
      }
      await assertFails(unauthorizedAuthed().doc(episodePath).get());
      await assertFails(unauth().collection(episodesPath).get());
    });

    it('no client role creates, edits or deletes an episode document', async () => {
      for (const db of [admin, nurse, editor, doctor]) {
        await assertFails(db().doc(`${episodesPath}/ep_synthetic_new`).set(episode));
      }
      await setupDocBypass(episodePath, episode);
      for (const db of [admin, nurse]) {
        await assertFails(db().doc(episodePath).update({ vitalSignsHistory: [] }));
        await assertFails(db().doc(episodePath).delete());
      }
    });

    it('a client update never adds, changes or removes the day marker', async () => {
      await setupDocBypass(recordPath, baseDay);
      for (const db of [admin, nurse]) {
        await assertFails(db().doc(recordPath).update({ clinicalDerivedLayout: marker }));
      }

      await setupDocBypass(recordPath, markedDay);
      const other = { ...marker, generation: 'gen_synthetic_b' };
      for (const db of [admin, nurse]) {
        await assertFails(db().doc(recordPath).update({ clinicalDerivedLayout: other }));
        await assertFails(db().doc(recordPath).update({ 'clinicalDerivedLayout.version': 2 }));
        await assertFails(db().doc(recordPath).update({ clinicalDerivedLayout: deleteField() }));
        // A full save from a copy taken before the day was marked.
        await assertFails(db().doc(recordPath).set(baseDay));
      }
    });

    it('a marked day keeps ordinary edits and full saves that carry its marker and revision', async () => {
      await setupDocBypass(recordPath, markedDay);
      await assertSucceeds(
        nurse()
          .doc(recordPath)
          .update({ nursesDayShift: ['Otra Enfermera'] })
      );
      await assertSucceeds(nurse().doc(recordPath).set(markedDay));
      await assertSucceeds(
        admin()
          .doc(recordPath)
          .set({ ...markedDay, meta: { revision: 6 } })
      );
    });

    it('a marked day never moves meta.revision back; an unmarked day is unchanged', async () => {
      await setupDocBypass(recordPath, markedDay);
      for (const db of [admin, nurse]) {
        await assertFails(db().doc(recordPath).update({ 'meta.revision': 4 }));
        await assertFails(
          db()
            .doc(recordPath)
            .set({ ...markedDay, meta: {} })
        );
        await assertFails(db().doc(recordPath).set(withoutMeta));
      }

      await setupDocBypass(recordPath, baseDay);
      await assertSucceeds(nurse().doc(recordPath).update({ 'meta.revision': 4 }));
      await assertSucceeds(
        admin()
          .doc(recordPath)
          .set({ ...baseDay, meta: {} })
      );
    });

    it('a day recreated from a local copy may carry its marker on create', async () => {
      await assertSucceeds(nurse().doc(recordPath).set(markedDay));
    });
  });
}
