import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { describe, it } from 'vitest';
import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

export function registerMigrationReleaseGuards({
  unauth,
  authed,
  unauthorizedAuthed,
  doctor,
  nurse,
  admin,
  NOW_MS,
  setupDocBypass,
}: FirestoreRulesHarness): void {
  describe('Migration release permission boundaries', () => {
    const at = new Date(NOW_MS).toISOString();
    it('keeps nurse photo metadata workflows but rejects uploaded-source replacement and forged actor', async () => {
      const path = 'hospitals/H1/prescriptions/source-photo';
      await setupDocBypass(path, {
        storagePath: 'immutable-source',
        uploadedBy: 'server',
        prescriptionType: 'comun',
        patientRut: null,
        assignmentScope: 'unassigned',
      });
      await assertSucceeds(
        nurse().doc(path).update({
          prescriptionType: 'psicotropicos',
          typeUpdatedBy: 'hospitalizados@hospitalhangaroa.cl',
          typeUpdatedAt: at,
        })
      );
      await assertSucceeds(
        nurse().doc(path).update({
          patientName: 'Paciente sintético',
          patientRut: 'synthetic-document',
          bedId: 'R1',
          assignmentScope: 'patient',
          patientReassignedBy: 'user_nurse',
          patientReassignedAt: at,
        })
      );
      // A later correction cannot reuse the previous command's audit time.
      await assertFails(nurse().doc(path).update({ patientRut: 'other-document' }));
      await assertFails(nurse().doc(path).update({ prescriptionType: 'comun' }));
      await assertFails(
        nurse().doc(path).update({ patientReassignedBy: 'hospitalizados@hospitalhangaroa.cl' })
      );
      const later = new Date(NOW_MS + 1000).toISOString();
      // The same actor legitimately remains unchanged across consecutive commands.
      await assertSucceeds(
        nurse().doc(path).update({ patientRut: 'other-document', patientReassignedAt: later })
      );
      await assertSucceeds(
        nurse().doc(path).update({ prescriptionType: 'comun', typeUpdatedAt: later })
      );
      // The existing reassignment dialog permits reconfirming the same patient.
      await assertSucceeds(
        nurse()
          .doc(path)
          .update({ patientReassignedAt: new Date(NOW_MS + 2000).toISOString() })
      );
      await assertFails(nurse().doc(path).update({ storagePath: 'replaced-source' }));
      await assertFails(nurse().doc(path).update({ uploadedBy: 'user_nurse' }));
      await assertFails(
        nurse()
          .doc(path)
          .update({ prescriptionType: 'comun', typeUpdatedBy: 'user_admin', typeUpdatedAt: at })
      );
      await assertFails(
        nurse()
          .doc(path)
          .update({ prescriptionType: 'unknown', typeUpdatedBy: 'user_nurse', typeUpdatedAt: at })
      );
      await assertSucceeds(admin().doc(path).update({ storagePath: 'admin-repair' }));
      // Manual nurse removal is an existing supported photo-backup workflow.
      await assertSucceeds(nurse().doc(path).delete());
    });

    it('enforces prescriptions create/read/delete and PIN access config boundaries', async () => {
      const path = 'hospitals/H1/prescriptions/rx-boundary';
      const pinConfigPath = 'config/prescriptionsAccess';

      // Direct client creates are forbidden (uploads go through Cloud Function).
      await assertFails(
        admin().doc(path).set({ storagePath: 'client-attempt', uploadedBy: 'admin' })
      );
      await assertFails(
        nurse().doc(path).set({ storagePath: 'client-attempt', uploadedBy: 'nurse' })
      );

      await setupDocBypass(path, {
        storagePath: 'prescriptions/hhr/rx-boundary/full.jpg',
        uploadedBy: 'server',
        prescriptionType: 'comun',
        patientRut: null,
        assignmentScope: 'unassigned',
      });

      // Clinical staff can read; unauthenticated and unauthorized users cannot.
      await assertSucceeds(nurse().doc(path).get());
      await assertSucceeds(doctor().doc(path).get());
      await assertSucceeds(authed().doc(path).get());
      await assertFails(unauth().doc(path).get());
      await assertFails(unauthorizedAuthed().doc(path).get());

      // Delete is restricted to clinical editors (admin/nursing), not doctors or viewers.
      await assertFails(doctor().doc(path).delete());
      await assertFails(authed().doc(path).delete());
      await assertSucceeds(admin().doc(path).delete());

      // PIN access config is admin-readable only and never client-writable.
      await setupDocBypass(pinConfigPath, { pinHash: 'synthetic-hash' });
      await assertSucceeds(admin().doc(pinConfigPath).get());
      await assertFails(nurse().doc(pinConfigPath).get());
      await assertFails(doctor().doc(pinConfigPath).get());
      await assertFails(unauth().doc(pinConfigPath).get());
      await assertFails(admin().doc(pinConfigPath).set({ pinHash: 'client-write' }));
      await assertFails(admin().doc(pinConfigPath).update({ pinHash: 'client-write' }));
      await assertFails(admin().doc(pinConfigPath).delete());
    });
  });
}
