import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { describe, it } from 'vitest';
import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

export function registerMigrationReleaseGuards({
  doctor,
  specialist,
  nurse,
  admin,
  NOW_MS,
  CURRENT_RECORD_DATE,
  setupDocBypass,
}: FirestoreRulesHarness): void {
  describe('Migration release permission boundaries', () => {
    const at = new Date(NOW_MS).toISOString();
    it('allows deleting an owned template and refuses another user template', async () => {
      const path = 'hospitals/H1/medicalIndicationTemplates/user_doctor/items/delete-own';
      await assertSucceeds(doctor().doc(path).set({ userId: 'user_doctor', text: 'Sintético' }));
      await assertFails(specialist().doc(path).delete());
      await assertSucceeds(doctor().doc(path).delete());
    });
    const indication = (id: string, role: string | null = 'doctor_urgency') => ({
      id,
      patientRut: 'synthetic-document',
      patientName: 'Paciente sintético',
      episodeId: 'synthetic-episode',
      bedId: 'R1',
      targetDate: CURRENT_RECORD_DATE,
      generatedAt: at,
      generatedByUserId: 'user_doctor',
      generatedByName: 'Doctor sintético',
      generatedByRole: role,
      generatedFromTemplateIds: [],
      admissionDate: CURRENT_RECORD_DATE,
      daysOfStayForTargetDate: '1',
      treatingDoctor: 'Doctor sintético',
      reposo: 'Relativo',
      regimen: 'Normal',
      kineType: 'ninguna',
      kineTimes: '',
      pendingNotes: '',
      indications: ['Control sintético'],
      pdfPrintedAt: null,
    });
    it('binds immutable indication identity and any informed role to the authenticated author', async () => {
      const base = 'hospitals/H1/medicalIndicationRecords/';
      await assertFails(
        doctor()
          .doc(base + 'path-id')
          .set(indication('different-id'))
      );
      await assertFails(
        doctor()
          .doc(base + 'forged-role')
          .set(indication('forged-role', 'admin'))
      );
      await assertSucceeds(
        doctor()
          .doc(base + 'correct-role')
          .set(indication('correct-role'))
      );
      await assertSucceeds(
        doctor()
          .doc(base + 'legacy-null')
          .set(indication('legacy-null', null))
      );
      const { generatedByRole: _role, ...legacy } = indication('legacy-absent');
      await assertSucceeds(
        doctor()
          .doc(base + 'legacy-absent')
          .set(legacy)
      );
    });
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
  });
}
