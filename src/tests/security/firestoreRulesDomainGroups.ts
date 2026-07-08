import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { describe, it } from 'vitest';

import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

export function registerFirestoreRulesDomainGroups({
  unauth,
  authed,
  admin,
  nurse,
  doctor,
  specialist,
  specialistWithoutClaim,
  doctorWithoutClaim,
  editor,
  firestoreForUser,
  NOW_MS,
  CURRENT_RECORD_DATE,
  setupDoc,
  setupDocBypass,
}: FirestoreRulesHarness): void {
  describe('Clinical Documents Collection', () => {
    const clinicalDocumentPath = 'hospitals/H1/clinicalDocuments/doc-1';
    const clinicalDocumentPayload = {
      id: 'doc-1',
      documentType: 'epicrisis',
      templateId: 'epicrisis',
      title: 'Epicrisis médica',
      episodeKey: '157894824__2026-03-04',
      patientRut: '15.789.482-4',
      status: 'draft',
      currentVersion: 1,
      audit: {
        createdAt: new Date(NOW_MS).toISOString(),
        updatedAt: new Date(NOW_MS).toISOString(),
      },
    };

    it('Doctors can create clinical documents', async () => {
      await assertSucceeds(doctor().doc(clinicalDocumentPath).set(clinicalDocumentPayload));
    });

    it('Specialists can create and update draft clinical documents', async () => {
      await assertSucceeds(specialist().doc(clinicalDocumentPath).set(clinicalDocumentPayload));
      await assertSucceeds(
        specialist()
          .doc(clinicalDocumentPath)
          .update({
            title: 'Epicrisis especialista',
            currentVersion: 2,
            'audit.updatedAt': new Date(NOW_MS + 1).toISOString(),
          })
      );
    });

    it('Specialists resolved via config/roles can create and update draft clinical documents', async () => {
      await assertSucceeds(
        specialistWithoutClaim().doc(clinicalDocumentPath).set(clinicalDocumentPayload)
      );
      await assertSucceeds(
        specialistWithoutClaim()
          .doc(clinicalDocumentPath)
          .update({
            title: 'Epicrisis especialista dinámica',
            currentVersion: 2,
            'audit.updatedAt': new Date(NOW_MS + 1).toISOString(),
          })
      );
    });

    it('Specialists cannot sign clinical documents through Firestore writes', async () => {
      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);

      await assertFails(
        specialist()
          .doc(clinicalDocumentPath)
          .update({
            status: 'signed',
            'audit.signedAt': new Date(NOW_MS + 1).toISOString(),
          })
      );
    });

    it('Specialists cannot modify a clinical document once it is signed', async () => {
      await setupDoc(admin(), clinicalDocumentPath, {
        ...clinicalDocumentPayload,
        status: 'signed',
      });

      await assertFails(
        specialist()
          .doc(clinicalDocumentPath)
          .update({
            title: 'Intento de cambio posterior a firma',
            currentVersion: 3,
            'audit.updatedAt': new Date(NOW_MS + 2).toISOString(),
          })
      );
    });

    it('Regular authenticated users cannot create clinical documents', async () => {
      await assertFails(authed().doc(clinicalDocumentPath).set(clinicalDocumentPayload));
    });

    it('Nurses and editors cannot create clinical documents', async () => {
      await assertFails(nurse().doc(clinicalDocumentPath).set(clinicalDocumentPayload));
      await assertFails(editor().doc(clinicalDocumentPath).set(clinicalDocumentPayload));
    });

    it('Doctors resolved via config/roles can create clinical documents', async () => {
      await setupDoc(admin(), 'config/roles', {
        'daniel.opazo@hospitalhangaroa.cl': 'admin',
        'doctor.allowed@example.com': 'doctor_urgency',
      });

      await assertSucceeds(
        doctorWithoutClaim().doc(clinicalDocumentPath).set(clinicalDocumentPayload)
      );
    });

    it('Doctors resolved via config/roles can update an existing draft clinical document', async () => {
      await setupDoc(admin(), 'config/roles', {
        'daniel.opazo@hospitalhangaroa.cl': 'admin',
        'doctor.allowed@example.com': 'doctor_urgency',
      });
      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);

      await assertSucceeds(
        doctorWithoutClaim()
          .doc(clinicalDocumentPath)
          .update({
            title: 'Epicrisis médica actualizada',
            currentVersion: 2,
            'audit.updatedAt': new Date(NOW_MS + 1).toISOString(),
          })
      );
    });

    it('Nurses and editors cannot update clinical documents', async () => {
      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);
      await assertFails(
        nurse()
          .doc(clinicalDocumentPath)
          .update({
            title: 'Cambio enfermería no permitido',
            currentVersion: 2,
            'audit.updatedAt': new Date(NOW_MS + 1).toISOString(),
          })
      );
      await assertFails(
        editor()
          .doc(clinicalDocumentPath)
          .update({
            title: 'Cambio editor no permitido',
            currentVersion: 2,
            'audit.updatedAt': new Date(NOW_MS + 1).toISOString(),
          })
      );
    });

    it('Delete is globally allowed only for admin and denied for non-author clinical roles', async () => {
      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);
      await assertSucceeds(admin().doc(clinicalDocumentPath).delete());

      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);
      await assertFails(doctor().doc(clinicalDocumentPath).delete());

      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);
      await assertFails(nurse().doc(clinicalDocumentPath).delete());

      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);
      await assertFails(editor().doc(clinicalDocumentPath).delete());

      await setupDoc(admin(), clinicalDocumentPath, clinicalDocumentPayload);
      await assertFails(authed().doc(clinicalDocumentPath).delete());
    });

    it('Document authors can delete their own active unlocked clinical document', async () => {
      await setupDoc(admin(), clinicalDocumentPath, {
        ...clinicalDocumentPayload,
        isActiveEpisodeDocument: true,
        isLocked: false,
        audit: {
          ...clinicalDocumentPayload.audit,
          createdBy: {
            uid: 'user_specialist',
            email: 'specialist@example.com',
            displayName: 'Especialista Test',
            role: 'doctor_specialist',
          },
        },
      });

      await assertSucceeds(specialist().doc(clinicalDocumentPath).delete());

      await setupDoc(admin(), clinicalDocumentPath, {
        ...clinicalDocumentPayload,
        isActiveEpisodeDocument: true,
        isLocked: true,
        audit: {
          ...clinicalDocumentPayload.audit,
          createdBy: {
            uid: 'user_specialist',
            email: 'specialist@example.com',
            displayName: 'Especialista Test',
            role: 'doctor_specialist',
          },
        },
      });

      await assertFails(specialist().doc(clinicalDocumentPath).delete());

      await setupDoc(admin(), clinicalDocumentPath, {
        ...clinicalDocumentPayload,
        isActiveEpisodeDocument: true,
        isLocked: true,
        audit: {
          ...clinicalDocumentPayload.audit,
          createdBy: {
            uid: 'user_specialist',
            email: 'specialist@example.com',
            displayName: 'Especialista Test',
            role: 'doctor_specialist',
          },
        },
      });

      await assertSucceeds(admin().doc(clinicalDocumentPath).delete());
    });

    it('Document authors can delete by email when a legacy uid no longer matches', async () => {
      await setupDoc(admin(), clinicalDocumentPath, {
        ...clinicalDocumentPayload,
        isActiveEpisodeDocument: true,
        isLocked: false,
        audit: {
          ...clinicalDocumentPayload.audit,
          createdBy: {
            uid: 'legacy_specialist_uid',
            email: 'specialist@example.com',
            displayName: 'Especialista Test',
            role: 'doctor_specialist',
          },
        },
      });

      await assertSucceeds(
        firestoreForUser('rotated_specialist_uid', {
          email: 'specialist@example.com',
          role: 'doctor_specialist',
        })
          .doc(clinicalDocumentPath)
          .delete()
      );

      await setupDoc(admin(), clinicalDocumentPath, {
        ...clinicalDocumentPayload,
        isActiveEpisodeDocument: true,
        isLocked: false,
        audit: {
          ...clinicalDocumentPayload.audit,
          createdBy: {
            uid: 'legacy_specialist_uid',
            email: 'unconfigured.author@example.com',
            displayName: 'Especialista Test',
            role: 'doctor_specialist',
          },
        },
      });

      await assertFails(
        firestoreForUser('other_specialist_uid', {
          email: 'other.specialist@example.com',
          role: 'doctor_specialist',
        })
          .doc(clinicalDocumentPath)
          .delete()
      );

      await assertFails(
        firestoreForUser('viewer_with_author_email', {
          email: 'unconfigured.author@example.com',
          role: 'viewer',
        })
          .doc(clinicalDocumentPath)
          .delete()
      );
    });
  });

  describe('Clinical Attachments Collection', () => {
    const clinicalAttachmentPath = 'hospitals/H1/clinicalAttachments/att-1';
    const clinicalAttachmentPayload = {
      id: 'att-1',
      hospitalId: 'H1',
      patientRut: '15.789.482-4',
      patientRutKey: '15789482-4',
      patientName: 'Paciente Test',
      episodeKey: '157894824__2026-03-04',
      documentId: 'doc-1',
      documentType: 'epicrisis',
      storagePath: 'clinical-attachments/H1/15789482-4/157894824__2026-03-04/att-1/informe.pdf',
      downloadUrl: 'https://example.test/informe.pdf',
      originalFileName: 'informe.pdf',
      displayName: 'informe.pdf',
      contentType: 'application/pdf',
      fileKind: 'pdf',
      sizeBytes: 1024,
      status: 'active',
      createdAt: new Date(NOW_MS).toISOString(),
      createdBy: {
        uid: 'user_doctor',
        email: 'doctor@example.com',
        displayName: 'Doctor Test',
        role: 'doctor_urgency',
      },
      updatedAt: new Date(NOW_MS).toISOString(),
      updatedBy: {
        uid: 'user_doctor',
        email: 'doctor@example.com',
        displayName: 'Doctor Test',
        role: 'doctor_urgency',
      },
    };

    it('allows clinical write roles to create attachment metadata', async () => {
      await assertSucceeds(doctor().doc(clinicalAttachmentPath).set(clinicalAttachmentPayload));
      await assertSucceeds(
        specialist()
          .doc('hospitals/H1/clinicalAttachments/att-specialist')
          .set({
            ...clinicalAttachmentPayload,
            id: 'att-specialist',
          })
      );
      await assertSucceeds(
        nurse()
          .doc('hospitals/H1/clinicalAttachments/att-nurse')
          .set({
            ...clinicalAttachmentPayload,
            id: 'att-nurse',
          })
      );
      await assertSucceeds(
        editor()
          .doc('hospitals/H1/clinicalAttachments/att-editor')
          .set({
            ...clinicalAttachmentPayload,
            id: 'att-editor',
          })
      );
    });

    it('allows clinical write roles to mark attachment metadata as deleted', async () => {
      await setupDoc(admin(), clinicalAttachmentPath, clinicalAttachmentPayload);

      await assertSucceeds(
        doctor()
          .doc(clinicalAttachmentPath)
          .update({
            status: 'deleted',
            deletedAt: new Date(NOW_MS + 1).toISOString(),
            updatedAt: new Date(NOW_MS + 1).toISOString(),
          })
      );
    });

    it('keeps viewers read-only for attachment metadata', async () => {
      await setupDoc(admin(), clinicalAttachmentPath, clinicalAttachmentPayload);

      await assertSucceeds(authed().doc(clinicalAttachmentPath).get());
      await assertFails(
        authed()
          .doc('hospitals/H1/clinicalAttachments/att-viewer')
          .set({
            ...clinicalAttachmentPayload,
            id: 'att-viewer',
          })
      );
      await assertFails(
        authed()
          .doc(clinicalAttachmentPath)
          .update({
            status: 'deleted',
            updatedAt: new Date(NOW_MS + 1).toISOString(),
          })
      );
    });
  });

  describe('Export Passwords', () => {
    const exportPath = 'hospitals/H1/exportPasswords/2025-01-01';

    it('Authenticated users can read export passwords', async () => {
      await setupDoc(admin(), exportPath, { password: 'secret' });
      await assertSucceeds(authed().doc(exportPath).get());
    });

    it('Unauthenticated users cannot read export passwords', async () => {
      await assertFails(unauth().doc(exportPath).get());
    });

    it('Admins can write export passwords', async () => {
      await assertSucceeds(admin().doc(exportPath).set({ password: 'secret' }));
    });

    it('Non-admins cannot write export passwords', async () => {
      await assertFails(authed().doc(exportPath).set({ password: 'secret' }));
    });
  });

  describe('Global Email Recipient Lists', () => {
    const emailListPath = 'emailRecipientLists/census-default';

    it('Admins can read and write global email recipient lists', async () => {
      await assertSucceeds(
        admin()
          .doc(emailListPath)
          .set({
            name: 'Lista global',
            recipients: ['uno@hospital.cl'],
            scope: 'global',
          })
      );
      await assertSucceeds(admin().doc(emailListPath).get());
    });

    it('Nurses can read and write global email recipient lists', async () => {
      await assertSucceeds(
        nurse()
          .doc(emailListPath)
          .set({
            name: 'Lista global',
            recipients: ['uno@hospital.cl'],
            scope: 'global',
          })
      );
      await assertSucceeds(nurse().doc(emailListPath).get());
    });

    it('Editors can write global email recipient lists', async () => {
      await assertSucceeds(
        editor()
          .doc(emailListPath)
          .set({
            name: 'Lista global',
            recipients: ['uno@hospital.cl'],
            scope: 'global',
          })
      );
    });

    it('Regular users cannot write global email recipient lists', async () => {
      await assertFails(
        authed()
          .doc(emailListPath)
          .set({
            name: 'Lista global',
            recipients: ['uno@hospital.cl'],
            scope: 'global',
          })
      );
    });

    it('Unauthenticated users cannot read global email recipient lists', async () => {
      await assertFails(unauth().doc(emailListPath).get());
    });
  });

  describe('Transfer Requests', () => {
    const transferPath = 'hospitals/H1/transferRequests/TR-1';

    it('Nurses can create transfer requests', async () => {
      await assertSucceeds(nurse().doc(transferPath).set({ status: 'pending' }));
    });

    it('Nurses can remove active transfer requests when finalizing or correcting the workflow', async () => {
      await setupDoc(admin(), transferPath, { status: 'REQUESTED' });

      await assertSucceeds(nurse().doc(transferPath).delete());
    });

    it('Non-nurse users cannot create transfer requests', async () => {
      await assertFails(authed().doc(transferPath).set({ status: 'pending' }));
    });
  });

  describe('Backup Files', () => {
    const backupPath = 'hospitals/H1/backupFiles/file1';

    it('Only editors can create backup files', async () => {
      await assertFails(authed().doc(backupPath).set({ name: 'file.pdf' }));
      await assertSucceeds(nurse().doc(backupPath).set({ name: 'file.pdf' }));
    });

    it('Unauthenticated users cannot read backup files', async () => {
      await assertFails(unauth().doc(backupPath).get());
    });

    it('Admins can update backup files', async () => {
      await setupDoc(admin(), backupPath, { name: 'file.pdf' });
      await assertSucceeds(admin().doc(backupPath).update({ name: 'file-v2.pdf' }));
    });

    it('Non-admins cannot update backup files', async () => {
      await setupDoc(admin(), backupPath, { name: 'file.pdf' });
      await assertFails(authed().doc(backupPath).update({ name: 'file-v2.pdf' }));
    });
  });

  describe('Medical Indications Collections', () => {
    const templatePath = 'hospitals/H1/medicalIndicationTemplates/user_doctor/items/tpl-1';
    const recordPath = 'hospitals/H1/medicalIndicationRecords/record-1';
    const templatePayload = {
      id: 'tpl-1',
      userId: 'user_doctor',
      text: 'Control de signos vitales cada 6 horas',
      createdAt: new Date(NOW_MS).toISOString(),
      updatedAt: new Date(NOW_MS).toISOString(),
      createdByName: 'Doctor Test',
      useCount: 0,
      isArchived: false,
    };
    const recordPayload = {
      id: 'record-1',
      patientRut: '15.789.482-4',
      patientName: 'Paciente Test',
      episodeId: 'ep_test',
      bedId: 'R1',
      targetDate: CURRENT_RECORD_DATE,
      generatedAt: new Date(NOW_MS).toISOString(),
      generatedByUserId: 'user_doctor',
      generatedByName: 'Doctor Test',
      generatedByRole: 'doctor_urgency',
      generatedFromTemplateIds: [],
      admissionDate: CURRENT_RECORD_DATE,
      daysOfStayForTargetDate: '1',
      treatingDoctor: 'Doctor Test',
      reposo: 'Relativo',
      regimen: 'Liviano',
      kineType: 'ninguna',
      kineTimes: '',
      pendingNotes: '',
      indications: ['Control'],
      pdfPrintedAt: null,
    };

    it('users can manage only their own personal medical indication templates', async () => {
      await assertSucceeds(doctor().doc(templatePath).set(templatePayload));
      await assertSucceeds(
        doctor()
          .doc(templatePath)
          .update({
            text: 'Control cada 8 horas',
            updatedAt: new Date(NOW_MS + 1).toISOString(),
            userId: 'user_doctor',
          })
      );

      await assertFails(
        specialist()
          .doc(templatePath)
          .set({ ...templatePayload, id: 'tpl-other' })
      );
      await assertFails(
        doctor()
          .doc('hospitals/H1/medicalIndicationTemplates/user_specialist/items/tpl-2')
          .set({ ...templatePayload, id: 'tpl-2', userId: 'user_doctor' })
      );
    });

    it('clinical write doctors can create generated medical indication records', async () => {
      await assertSucceeds(doctor().doc(recordPath).set(recordPayload));
      await assertSucceeds(
        specialist()
          .doc('hospitals/H1/medicalIndicationRecords/record-specialist')
          .set({
            ...recordPayload,
            id: 'record-specialist',
            generatedByUserId: 'user_specialist',
            generatedByRole: 'doctor_specialist',
          })
      );
      await assertSucceeds(
        admin()
          .doc('hospitals/H1/medicalIndicationRecords/record-admin')
          .set({
            ...recordPayload,
            id: 'record-admin',
            generatedByUserId: 'user_admin',
            generatedByRole: 'admin',
          })
      );
    });

    it('rejects generated medical indication records with forged author identity or malformed payloads', async () => {
      await assertFails(
        doctor()
          .doc('hospitals/H1/medicalIndicationRecords/record-forged')
          .set({
            ...recordPayload,
            id: 'record-forged',
            generatedByUserId: 'user_specialist',
            generatedByName: 'Especialista Falso',
          })
      );
      await assertFails(
        doctor()
          .doc('hospitals/H1/medicalIndicationRecords/record-malformed')
          .set({
            ...recordPayload,
            id: 'record-malformed',
            generatedByUserId: 'user_doctor',
            generatedAt: NOW_MS,
            indications: [],
            extraDebugField: 'no debería persistir',
          })
      );
    });

    it('generated medical indication records are readable but append-only', async () => {
      await setupDoc(admin(), recordPath, {
        ...recordPayload,
        generatedByUserId: 'user_admin',
        generatedByRole: 'admin',
      });

      await assertSucceeds(nurse().doc(recordPath).get());
      await assertSucceeds(authed().doc(recordPath).get());
      await assertFails(
        nurse().doc('hospitals/H1/medicalIndicationRecords/record-nurse').set(recordPayload)
      );
      await assertFails(doctor().doc(recordPath).update({ pendingNotes: 'Cambio posterior' }));
      await assertFails(admin().doc(recordPath).delete());
    });
  });

  describe('Analytics Specialty Reclassifications', () => {
    const reclassificationPath =
      'hospitals/H1/analyticsSpecialtyReclassifications/2026-03-05_discharge_d-1';
    const reclassificationPayload = {
      date: CURRENT_RECORD_DATE,
      movementKind: 'discharge',
      movementId: 'd-1',
      originalSpecialty: 'Oftalmología',
      reportingSpecialty: 'Cirugía',
      active: true,
      updatedAt: new Date(NOW_MS).toISOString(),
      updatedByUid: 'user_admin',
      updatedByEmail: 'admin@example.com',
    };

    it('clinical users can read official statistical specialty reclassifications', async () => {
      await setupDocBypass(reclassificationPath, reclassificationPayload);

      await assertSucceeds(nurse().doc(reclassificationPath).get());
      await assertSucceeds(specialist().doc(reclassificationPath).get());
    });

    it('clients cannot write statistical specialty reclassifications directly', async () => {
      await assertFails(admin().doc(reclassificationPath).set(reclassificationPayload));
      await assertFails(nurse().doc(reclassificationPath).set(reclassificationPayload));

      await setupDocBypass(reclassificationPath, reclassificationPayload);
      await assertFails(admin().doc(reclassificationPath).update({ reportingSpecialty: 'Otro' }));
      await assertFails(admin().doc(reclassificationPath).delete());
    });
  });
}
