import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { describe, it } from 'vitest';
import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

export function registerClinicalDocumentIntegrityRules(harness: FirestoreRulesHarness): void {
  const path = 'hospitals/H1/clinicalDocuments/integrity';
  const originalAuthor = { uid: 'another_author', email: 'another@example.com' };
  const document = {
    status: 'draft',
    isActiveEpisodeDocument: true,
    isLocked: false,
    audit: { createdBy: originalAuthor },
  };
  describe('Clinical document authority integrity', () => {
    for (const role of ['doctor', 'specialist'] as const) {
      const actor = { uid: `user_${role}`, email: `${role}@example.com` };
      it(`${role} cannot replace author then delete another author's document`, async () => {
        const writer = harness[role]().doc(path);
        await harness.setupDocBypass(path, document);
        await assertFails(writer.update({ 'audit.createdBy': actor }));
        await assertFails(writer.update({ 'audit.createdBy.uid': actor.uid }));
        await assertFails(writer.update({ 'audit.createdBy.email': actor.email }));
        await assertFails(writer.set({ ...document, audit: {} }));
        await assertFails(writer.delete());
      });

      it(`${role} can edit content and close an episode while retaining its author`, async () => {
        const writer = harness[role]().doc(path);
        await harness.setupDocBypass(path, document);
        await assertSucceeds(writer.update({ title: 'Updated note', 'audit.updatedBy': actor }));
        await assertSucceeds(writer.update({ isLocked: true, lockedReason: 'episode_closed' }));
        await assertSucceeds(writer.update({ isActiveEpisodeDocument: false }));
      });

      it(`${role} cannot unlock or reactivate their own closed-episode document`, async () => {
        const writer = harness[role]().doc(path);
        await harness.setupDocBypass(path, {
          ...document,
          isLocked: true,
          lockedReason: 'episode_closed',
          isActiveEpisodeDocument: false,
          audit: { createdBy: actor },
        });
        await assertFails(writer.update({ isLocked: false }));
        await assertFails(writer.update({ lockedReason: '' }));
        await assertFails(writer.set({ ...document, audit: { createdBy: actor } }));
        await assertFails(writer.delete());
      });

      it(`${role} cannot reactivate an archived but unlocked document to delete it`, async () => {
        const writer = harness[role]().doc(path);
        await harness.setupDocBypass(path, {
          ...document,
          isActiveEpisodeDocument: false,
          audit: { createdBy: actor },
        });
        await assertFails(writer.update({ isActiveEpisodeDocument: true }));
        await assertFails(writer.delete());
      });

      it(`${role} can still delete their own active unlocked document`, async () => {
        await harness.setupDocBypass(path, { ...document, audit: { createdBy: actor } });
        await assertSucceeds(harness[role]().doc(path).delete());
      });

      it(`${role} can hydrate missing legacy author fields without claiming authorship`, async () => {
        const writer = harness[role]().doc(path);
        const legacy = { uid: 'legacy-unknown', email: 'legacy@unknown.local' };
        for (const audit of [{}, { createdBy: null }, { createdBy: { uid: ' ', email: '' } }]) {
          await harness.setupDocBypass(path, { ...document, audit });
          await assertFails(writer.update({ 'audit.createdBy': actor }));
          await assertSucceeds(writer.update({ 'audit.createdBy': legacy }));
          await assertFails(writer.update({ 'audit.createdBy': actor }));
        }
      });

      it(`${role} can hydrate a partial legacy author without replacing the known identity`, async () => {
        const writer = harness[role]().doc(path);
        await harness.setupDocBypass(path, {
          ...document,
          audit: { createdBy: { email: originalAuthor.email } },
        });
        await assertFails(writer.update({ 'audit.createdBy.uid': actor.uid }));
        await assertSucceeds(
          writer.update({
            'audit.createdBy.uid': 'legacy-unknown',
            'audit.createdBy.displayName': 'Usuario legado',
            'audit.createdBy.role': 'legacy_unknown',
          })
        );
      });
    }

    it('preserves the retired signature-lock normalization for legacy documents', async () => {
      await harness.setupDocBypass(path, { ...document, status: 'signed', isLocked: true });
      await assertSucceeds(harness.doctor().doc(path).update({ status: 'draft', isLocked: false }));
    });

    it('allows explicit administrator corrections', async () => {
      await harness.setupDocBypass(path, {
        ...document,
        isLocked: true,
        lockedReason: 'episode_closed',
        isActiveEpisodeDocument: false,
      });
      await assertSucceeds(
        harness
          .admin()
          .doc(path)
          .set({
            ...document,
            audit: { createdBy: { uid: 'corrected', email: 'corrected@example.com' } },
          })
      );
    });
  });
}
