import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { serverTimestamp } from 'firebase/firestore';
import { beforeEach, describe, it } from 'vitest';

import type { FirestoreRulesHarness } from './firestoreRulesTestHarness';

export function registerFirestoreRulesAccessGroups({
  unauth,
  authed,
  admin,
  nurse,
  doctor,
  specialist,
  specialistWithoutClaim,
  adminWithoutClaim,
  firestoreForUser,
  unauthorizedAuthed,
  NOW_MS,
  THREE_DAYS_MS,
  CURRENT_RECORD_DATE,
  PREVIOUS_RECORD_DATE,
  setupDoc,
}: FirestoreRulesHarness): void {
  describe('Audit Logs Collection', () => {
    const auditCollection = (db: ReturnType<FirestoreRulesHarness['authed']>) =>
      db.collection('hospitals/H1/auditLogs');

    it('Unauthenticated users cannot read audit logs', async () => {
      await assertFails(auditCollection(unauth()).get());
    });

    it('Admins can read audit logs', async () => {
      await assertSucceeds(auditCollection(admin()).get());
    });

    it('Configured admins can read audit logs without an admin claim', async () => {
      await setupDoc(admin(), 'hospitals/H1/auditLogs/log-dynamic-admin', { action: 'TEST' });
      await assertSucceeds(auditCollection(adminWithoutClaim()).get());
    });

    it('Any authenticated user can create an audit log', async () => {
      await assertSucceeds(
        auditCollection(authed()).add({ action: 'TEST_ACTION', timestamp: 123456 })
      );
    });

    it('Authenticated users without an effective role cannot create audit logs', async () => {
      await assertFails(
        auditCollection(unauthorizedAuthed()).add({ action: 'TEST_ACTION', timestamp: 123456 })
      );
    });

    it('Regular users CANNOT delete audit logs', async () => {
      const db = authed();
      await setupDoc(admin(), 'hospitals/H1/auditLogs/log1', { action: 'TEST' });
      await assertFails(db.doc('hospitals/H1/auditLogs/log1').delete());
    });

    it('Admins CANNOT delete audit logs (append-only policy)', async () => {
      const db = admin();
      await setupDoc(db, 'hospitals/H1/auditLogs/log1', { action: 'TEST' });
      await assertFails(db.doc('hospitals/H1/auditLogs/log1').delete());
    });

    it('Admins CANNOT update audit logs (append-only policy)', async () => {
      const db = admin();
      await setupDoc(db, 'hospitals/H1/auditLogs/log1', { action: 'TEST' });
      await assertFails(db.doc('hospitals/H1/auditLogs/log1').update({ action: 'TAMPERED' }));
    });
  });

  describe('Daily Records Collection', () => {
    const recordPath = `hospitals/H1/dailyRecords/${CURRENT_RECORD_DATE}`;
    const historyPath = `hospitals/H1/dailyRecords/${CURRENT_RECORD_DATE}/history/h-1`;

    it('Authenticated users can read daily records', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE });
      await assertSucceeds(authed().doc(recordPath).get());
    });

    it('Authenticated users without role cannot read daily records', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE });
      await assertFails(unauthorizedAuthed().doc(recordPath).get());
    });

    it('Configured admins can recover daily record access without an admin claim', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE });
      await assertSucceeds(adminWithoutClaim().doc(recordPath).get());
    });

    it('Unauthenticated users cannot read daily records', async () => {
      await assertFails(unauth().doc(recordPath).get());
    });

    it('Nurses can update records within the editing window', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
      });

      await assertSucceeds(
        nurse()
          .doc(recordPath)
          .update({ nursesDayShift: ['Nurse1'] })
      );
    });

    it('Admins and nurses can both update current-day staffing fields', async () => {
      const staffingPayload = {
        nurses: ['Nurse Day 1', 'Nurse Day 2'],
        nursesDayShift: ['Nurse Day 1', 'Nurse Day 2'],
        nursesNightShift: ['Nurse Night 1', 'Nurse Night 2'],
        tensDayShift: ['TENS Day 1', 'TENS Day 2', 'TENS Day 3'],
        tensNightShift: ['TENS Night 1', 'TENS Night 2', 'TENS Night 3'],
        staffingDetailsV1: {
          day: {
            nurses: [
              {
                id: 'day-nurse-standard-0',
                name: 'Nurse Day 1',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 0,
              },
              {
                id: 'day-nurse-standard-1',
                name: 'Nurse Day 2',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 1,
              },
            ],
            tens: [
              {
                id: 'day-tens-standard-0',
                name: 'TENS Day 1',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 0,
              },
              {
                id: 'day-tens-standard-1',
                name: 'TENS Day 2',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 1,
              },
              {
                id: 'day-tens-standard-2',
                name: 'TENS Day 3',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 2,
              },
            ],
          },
          night: {
            nurses: [
              {
                id: 'night-nurse-standard-0',
                name: 'Nurse Night 1',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 0,
              },
              {
                id: 'night-nurse-standard-1',
                name: 'Nurse Night 2',
                role: 'nurse',
                slotType: 'standard',
                standardSlotIndex: 1,
              },
            ],
            tens: [
              {
                id: 'night-tens-standard-0',
                name: 'TENS Night 1',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 0,
              },
              {
                id: 'night-tens-standard-1',
                name: 'TENS Night 2',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 1,
              },
              {
                id: 'night-tens-standard-2',
                name: 'TENS Night 3',
                role: 'tens',
                slotType: 'standard',
                standardSlotIndex: 2,
              },
            ],
          },
        },
        lastUpdated: NOW_MS,
      };

      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
      });

      await assertSucceeds(admin().doc(recordPath).update(staffingPayload));

      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
      });

      await assertSucceeds(nurse().doc(recordPath).update(staffingPayload));
    });

    it('Nurses can repair missing dateTimestamp while updating current records', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
      });

      await assertSucceeds(
        nurse()
          .doc(recordPath)
          .update({ nursesDayShift: ['Nurse1'], dateTimestamp: NOW_MS, lastUpdated: NOW_MS })
      );
    });

    it('Nurses resolved via config/roles can update records without a token role claim', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
      });

      await assertSucceeds(
        firestoreForUser('user_nurse_config_only', {
          email: 'hospitalizados@hospitalhangaroa.cl',
        })
          .doc(recordPath)
          .update({ nursesDayShift: ['Nurse Config'], lastUpdated: NOW_MS })
      );
    });

    it('Nurses cannot update records outside the editing window', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS - THREE_DAYS_MS,
      });

      await assertFails(
        nurse()
          .doc(recordPath)
          .update({ nursesDayShift: ['Nurse1'] })
      );
    });

    it('Doctors can update only medical signature fields', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });

      await assertSucceeds(
        doctor().doc(recordPath).update({
          medicalSignature: 'signed',
          lastUpdated: NOW_MS,
          medicalHandoffDoctor: 'Dr. X',
          medicalHandoffSentAt: NOW_MS,
        })
      );
    });

    it('Doctors cannot update non-medical fields', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });

      await assertFails(
        doctor()
          .doc(recordPath)
          .update({
            nursesDayShift: ['Nurse1'],
          })
      );
    });

    it('Specialists can update only medical handoff and clinical event fields for one bed', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Test',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertSucceeds(
        specialist()
          .doc(recordPath)
          .update({
            'beds.R1.medicalHandoffNote': 'Evolución especialista',
            'beds.R1.medicalHandoffEntries': [
              {
                id: 'primary-entry',
                specialty: 'Med Interna',
                note: 'Evolución especialista',
              },
            ],
            'beds.R1.medicalHandoffAudit': {
              lastSpecialistUpdateAt: new Date(NOW_MS).toISOString(),
              lastSpecialistUpdateBy: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              currentStatus: 'updated_by_specialist',
            },
            'beds.R1.clinicalEvents': [
              {
                id: 'event-1',
                name: 'Evento clínico',
                date: CURRENT_RECORD_DATE,
                note: 'Control diario',
                createdAt: new Date(NOW_MS).toISOString(),
              },
            ],
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists resolved via config/roles can persist medical handoff changes', async () => {
      await setupDoc(admin(), 'config/roles', {
        'daniel.opazo@hospitalhangaroa.cl': 'admin',
        'specialist.dynamic@example.com': 'doctor_specialist',
      });
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Test',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertSucceeds(
        specialistWithoutClaim()
          .doc(recordPath)
          .update({
            'beds.R1.medicalHandoffNote': 'Persistencia por rol dinámico',
            'beds.R1.medicalHandoffEntries': [
              {
                id: 'primary-entry',
                specialty: 'Med Interna',
                note: 'Persistencia por rol dinámico',
              },
            ],
            'beds.R1.medicalHandoffAudit': {
              lastSpecialistUpdateAt: new Date(NOW_MS).toISOString(),
              lastSpecialistUpdateBy: {
                uid: 'user_specialist_dynamic',
                email: 'specialist.dynamic@example.com',
                displayName: 'Especialista dinámico',
                role: 'doctor_specialist',
              },
              currentStatus: 'updated_by_specialist',
            },
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists can update only medical handoff and clinical event fields for a clinical crib', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Test',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
            clinicalCrib: {
              patientName: 'RN Test',
              rut: '11-1',
              pathology: 'Observación',
              specialty: 'Pediatría',
              medicalHandoffNote: '',
              medicalHandoffEntries: [],
              clinicalEvents: [],
            },
          },
        },
      });

      await assertSucceeds(
        specialist()
          .doc(recordPath)
          .update({
            'beds.R1.clinicalCrib.medicalHandoffNote': 'Evolución RN',
            'beds.R1.clinicalCrib.medicalHandoffEntries': [
              {
                id: 'crib-entry',
                specialty: 'Pediatría',
                note: 'Evolución RN',
              },
            ],
            'beds.R1.clinicalCrib.medicalHandoffAudit': {
              lastSpecialistUpdateAt: new Date(NOW_MS).toISOString(),
              lastSpecialistUpdateBy: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              currentStatus: 'updated_by_specialist',
            },
            'beds.R1.clinicalCrib.clinicalEvents': [
              {
                id: 'crib-event-1',
                name: 'Control RN',
                date: CURRENT_RECORD_DATE,
                note: 'Seguimiento',
                createdAt: new Date(NOW_MS).toISOString(),
              },
            ],
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists cannot update unrelated clinical crib fields', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Test',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
            clinicalCrib: {
              patientName: 'RN Test',
              rut: '11-1',
              pathology: 'Observación',
              specialty: 'Pediatría',
              medicalHandoffNote: '',
              medicalHandoffEntries: [],
              clinicalEvents: [],
            },
          },
        },
      });

      await assertFails(
        specialist().doc(recordPath).update({
          'beds.R1.clinicalCrib.patientName': 'RN Renombrado',
          lastUpdated: NOW_MS,
        })
      );
    });

    it('Specialists resolved via config/roles remain authorized when the auth email uses different casing', async () => {
      await setupDoc(admin(), 'config/roles', {
        'daniel.opazo@hospitalhangaroa.cl': 'admin',
        'specialist.case@example.com': 'doctor_specialist',
      });
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Test',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertSucceeds(
        firestoreForUser('user_specialist_case', {
          email: 'Specialist.Case@Example.com',
          role: 'viewer',
        })
          .doc(recordPath)
          .update({
            'beds.R1.medicalHandoffNote': 'Persistencia con email normalizado',
            'beds.R1.medicalHandoffEntries': [
              {
                id: 'primary-entry',
                specialty: 'Med Interna',
                note: 'Persistencia con email normalizado',
              },
            ],
            'beds.R1.medicalHandoffAudit': {
              lastSpecialistUpdateAt: new Date(NOW_MS).toISOString(),
              lastSpecialistUpdateBy: {
                uid: 'user_specialist_case',
                email: 'Specialist.Case@Example.com',
                displayName: 'Especialista Case',
                role: 'doctor_specialist',
              },
              currentStatus: 'updated_by_specialist',
            },
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists can update structured medical handoff by specialty for the current day', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        medicalHandoffNovedades: '',
        medicalHandoffBySpecialty: {
          cirugia: {
            note: 'Nota previa',
            createdAt: new Date(NOW_MS - 86400000).toISOString(),
            updatedAt: new Date(NOW_MS - 86400000).toISOString(),
            author: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            lastEditor: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            version: 1,
            dailyContinuity: {},
          },
        },
      });

      await assertSucceeds(
        specialist()
          .doc(recordPath)
          .update({
            medicalHandoffNovedades: 'Cirugía\nEvolución especialista',
            'medicalHandoffBySpecialty.cirugia': {
              note: 'Evolución especialista',
              createdAt: new Date(NOW_MS - 86400000).toISOString(),
              updatedAt: new Date(NOW_MS).toISOString(),
              author: {
                uid: 'doctor-previo',
                email: 'previo@example.com',
                displayName: 'Especialista previo',
                role: 'doctor_specialist',
              },
              lastEditor: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              version: 2,
              dailyContinuity: {
                [CURRENT_RECORD_DATE]: {
                  status: 'updated_by_specialist',
                },
              },
            },
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Structured specialist handoff trusts config/roles over a stale token claim', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        medicalHandoffNovedades: '',
        medicalHandoffBySpecialty: {
          cirugia: {
            note: 'Nota previa',
            createdAt: new Date(NOW_MS - 86400000).toISOString(),
            updatedAt: new Date(NOW_MS - 86400000).toISOString(),
            author: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            lastEditor: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            version: 1,
            dailyContinuity: {},
          },
        },
      });

      await assertSucceeds(
        firestoreForUser('user_specialist_claim_drift', {
          email: 'specialist@example.com',
          role: 'viewer',
        })
          .doc(recordPath)
          .update({
            medicalHandoffNovedades: 'Cirugía\nEvolución con claim desactualizado',
            'medicalHandoffBySpecialty.cirugia': {
              note: 'Evolución con claim desactualizado',
              createdAt: new Date(NOW_MS - 86400000).toISOString(),
              updatedAt: new Date(NOW_MS).toISOString(),
              author: {
                uid: 'doctor-previo',
                email: 'previo@example.com',
                displayName: 'Especialista previo',
                role: 'doctor_specialist',
              },
              lastEditor: {
                uid: 'user_specialist_claim_drift',
                email: 'specialist@example.com',
                displayName: 'Especialista con claim viejo',
                role: 'doctor_specialist',
              },
              version: 2,
              dailyContinuity: {
                [CURRENT_RECORD_DATE]: {
                  status: 'updated_by_specialist',
                },
              },
            },
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists cannot update structured medical handoff and unrelated fields together', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        medicalHandoffNovedades: '',
        medicalHandoffBySpecialty: {
          cirugia: {
            note: 'Nota previa',
            createdAt: new Date(NOW_MS - 86400000).toISOString(),
            updatedAt: new Date(NOW_MS - 86400000).toISOString(),
            author: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            lastEditor: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            version: 1,
            dailyContinuity: {},
          },
        },
      });

      await assertFails(
        specialist()
          .doc(recordPath)
          .update({
            medicalHandoffNovedades: 'Cirugía\nEvolución especialista',
            'medicalHandoffBySpecialty.cirugia': {
              note: 'Evolución especialista',
              createdAt: new Date(NOW_MS - 86400000).toISOString(),
              updatedAt: new Date(NOW_MS).toISOString(),
              author: {
                uid: 'doctor-previo',
                email: 'previo@example.com',
                displayName: 'Especialista previo',
                role: 'doctor_specialist',
              },
              lastEditor: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              version: 2,
              dailyContinuity: {
                [CURRENT_RECORD_DATE]: {
                  status: 'updated_by_specialist',
                },
              },
            },
            nursesDayShift: ['Nurse1'],
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists cannot mix structured and bed-scoped handoff updates together', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        medicalHandoffNovedades: '',
        medicalHandoffBySpecialty: {
          cirugia: {
            note: 'Nota previa',
            createdAt: new Date(NOW_MS - 86400000).toISOString(),
            updatedAt: new Date(NOW_MS - 86400000).toISOString(),
            author: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            lastEditor: {
              uid: 'doctor-previo',
              email: 'previo@example.com',
              displayName: 'Especialista previo',
              role: 'doctor_specialist',
            },
            version: 1,
            dailyContinuity: {},
          },
        },
        beds: {
          R1: {
            patientName: 'Paciente Mixto',
            rut: '1-9',
            pathology: 'Control',
            specialty: 'Cirugia',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertFails(
        specialist()
          .doc(recordPath)
          .update({
            medicalHandoffNovedades: 'Cirugía\nIntento mixto',
            'medicalHandoffBySpecialty.cirugia': {
              note: 'Intento mixto',
              createdAt: new Date(NOW_MS - 86400000).toISOString(),
              updatedAt: new Date(NOW_MS).toISOString(),
              author: {
                uid: 'doctor-previo',
                email: 'previo@example.com',
                displayName: 'Especialista previo',
                role: 'doctor_specialist',
              },
              lastEditor: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              version: 2,
              dailyContinuity: {
                [CURRENT_RECORD_DATE]: {
                  status: 'updated_by_specialist',
                },
              },
            },
            'beds.R1.medicalHandoffNote': 'No debería mezclarse',
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists cannot update general census fields outside the allowed handoff scope', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Test',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            status: 'Estable',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertFails(
        specialist().doc(recordPath).update({
          'beds.R1.status': 'Grave',
          lastUpdated: NOW_MS,
        })
      );
    });

    it('Specialists cannot update two beds at once', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Uno',
            rut: '1-9',
            pathology: 'Neumonia',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
          R2: {
            patientName: 'Paciente Dos',
            rut: '2-7',
            pathology: 'Fractura',
            specialty: 'Cirugía',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertFails(
        specialist().doc(recordPath).update({
          'beds.R1.medicalHandoffNote': 'Cambio 1',
          'beds.R2.medicalHandoffNote': 'Cambio 2',
          lastUpdated: NOW_MS,
        })
      );
    });

    it('Specialists cannot update previous-day handoff records', async () => {
      const previousRecordPath = `hospitals/H1/dailyRecords/${PREVIOUS_RECORD_DATE}`;
      await setupDoc(admin(), previousRecordPath, {
        date: PREVIOUS_RECORD_DATE,
        dateTimestamp: NOW_MS - 86400000,
        beds: {
          R1: {
            patientName: 'Paciente Prev',
            rut: '3-5',
            pathology: 'Control',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertFails(
        specialist().doc(previousRecordPath).update({
          'beds.R1.medicalHandoffNote': 'Intento sobre día previo',
          lastUpdated: NOW_MS,
        })
      );
    });

    it('Specialists can repair missing dateTimestamp while persisting today handoff changes', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        beds: {
          R1: {
            patientName: 'Paciente Legacy',
            rut: '4-4',
            pathology: 'Control',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertSucceeds(
        specialist()
          .doc(recordPath)
          .update({
            'beds.R1.medicalHandoffNote': 'Actualización sobre registro legacy',
            'beds.R1.medicalHandoffEntries': [
              {
                id: 'primary-entry',
                specialty: 'Med Interna',
                note: 'Actualización sobre registro legacy',
              },
            ],
            'beds.R1.medicalHandoffAudit': {
              lastSpecialistUpdateAt: new Date(NOW_MS).toISOString(),
              lastSpecialistUpdateBy: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              currentStatus: 'updated_by_specialist',
            },
            dateTimestamp: NOW_MS,
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Specialists cannot alter an existing record timestamp while persisting handoff changes', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          R1: {
            patientName: 'Paciente Timestamp',
            rut: '5-2',
            pathology: 'Control',
            specialty: 'Med Interna',
            medicalHandoffNote: '',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });

      await assertFails(
        specialist()
          .doc(recordPath)
          .update({
            'beds.R1.medicalHandoffNote': 'Intento con timestamp alterado',
            'beds.R1.medicalHandoffEntries': [
              {
                id: 'primary-entry',
                specialty: 'Med Interna',
                note: 'Intento con timestamp alterado',
              },
            ],
            'beds.R1.medicalHandoffAudit': {
              lastSpecialistUpdateAt: new Date(NOW_MS).toISOString(),
              lastSpecialistUpdateBy: {
                uid: 'user_specialist',
                email: 'specialist@example.com',
                displayName: 'Especialista',
                role: 'doctor_specialist',
              },
              currentStatus: 'updated_by_specialist',
            },
            dateTimestamp: NOW_MS - 1000,
            lastUpdated: NOW_MS,
          })
      );
    });

    it('Admins can delete daily records', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE });
      await assertSucceeds(admin().doc(recordPath).delete());
    });

    it('Nurses CANNOT delete daily records', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });
      await assertFails(nurse().doc(recordPath).delete());
    });

    it('Nurses can create history snapshots under daily records', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });

      await assertSucceeds(
        nurse().doc(historyPath).set({
          snapshotTimestamp: NOW_MS,
          source: 'auto-save',
        })
      );
    });

    it('Doctors cannot create history snapshots under daily records', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });

      await assertFails(
        doctor().doc(historyPath).set({
          snapshotTimestamp: NOW_MS,
          source: 'manual',
        })
      );
    });

    it('Only admins can update or delete history snapshots', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });
      await setupDoc(admin(), historyPath, {
        snapshotTimestamp: NOW_MS,
        source: 'seed',
      });

      await assertFails(nurse().doc(historyPath).update({ source: 'nurse-edit' }));
      await assertFails(nurse().doc(historyPath).delete());
      await assertSucceeds(admin().doc(historyPath).update({ source: 'admin-edit' }));
      await assertSucceeds(admin().doc(historyPath).delete());
    });
  });

  describe('Reminders Collection', () => {
    const reminderPath = 'hospitals/H1/reminders/rem-1';
    const receiptPath = `${reminderPath}/readReceipts/user_nurse__2026-01-01__day`;

    beforeEach(async () => {
      await setupDoc(admin(), reminderPath, {
        title: 'Aviso de prueba',
        message: 'Mensaje',
        type: 'info',
        targetRoles: ['nurse_hospital'],
        targetShifts: ['day'],
        startDate: CURRENT_RECORD_DATE,
        endDate: CURRENT_RECORD_DATE,
        priority: 2,
        isActive: true,
        createdBy: 'admin',
        createdByName: 'Admin',
        createdAt: new Date(NOW_MS).toISOString(),
        updatedAt: new Date(NOW_MS).toISOString(),
      });
    });

    it('allows clinical users with role access to read reminders', async () => {
      await assertSucceeds(nurse().doc(reminderPath).get());
      await assertSucceeds(doctor().doc(reminderPath).get());
    });

    it('blocks unauthorized users from reading reminders', async () => {
      await assertFails(unauthorizedAuthed().doc(reminderPath).get());
    });

    it('allows admins to create reminders', async () => {
      await assertSucceeds(
        admin()
          .doc('hospitals/H1/reminders/rem-2')
          .set({
            title: 'Nuevo aviso',
            message: 'Texto',
            type: 'warning',
            targetRoles: ['nurse_hospital'],
            targetShifts: ['day'],
            startDate: CURRENT_RECORD_DATE,
            endDate: CURRENT_RECORD_DATE,
            priority: 3,
            isActive: true,
            createdBy: 'admin',
            createdByName: 'Admin',
            createdAt: new Date(NOW_MS).toISOString(),
            updatedAt: new Date(NOW_MS).toISOString(),
          })
      );
    });

    it('blocks non-admin users from creating reminders', async () => {
      await assertFails(
        nurse()
          .doc('hospitals/H1/reminders/rem-3')
          .set({
            title: 'Sin permiso',
            message: 'Texto',
            type: 'warning',
            targetRoles: ['nurse_hospital'],
            targetShifts: ['day'],
            startDate: CURRENT_RECORD_DATE,
            endDate: CURRENT_RECORD_DATE,
            priority: 1,
            isActive: true,
            createdBy: 'nurse',
            createdByName: 'Nurse',
            createdAt: new Date(NOW_MS).toISOString(),
            updatedAt: new Date(NOW_MS).toISOString(),
          })
      );
    });

    it('allows users to create their own read receipt only', async () => {
      await assertSucceeds(
        nurse()
          .doc(receiptPath)
          .set({
            userId: 'user_nurse',
            userName: 'Nurse',
            readAt: new Date(NOW_MS).toISOString(),
            shift: 'day',
            dateKey: CURRENT_RECORD_DATE,
          })
      );
    });

    it('blocks users from creating read receipts for another uid', async () => {
      await assertFails(
        nurse()
          .doc(`${reminderPath}/readReceipts/other-user`)
          .set({
            userId: 'other-user',
            userName: 'Nurse',
            readAt: new Date(NOW_MS).toISOString(),
            shift: 'day',
            dateKey: CURRENT_RECORD_DATE,
          })
      );
    });

    it('blocks users from creating read receipts with invalid shift payload', async () => {
      await assertFails(
        nurse()
          .doc(receiptPath)
          .set({
            userId: 'user_nurse',
            userName: 'Nurse',
            readAt: new Date(NOW_MS).toISOString(),
            shift: 'late',
            dateKey: CURRENT_RECORD_DATE,
          })
      );
    });

    it('blocks users from creating read receipts with unexpected fields', async () => {
      await assertFails(
        nurse()
          .doc(receiptPath)
          .set({
            userId: 'user_nurse',
            userName: 'Nurse',
            readAt: new Date(NOW_MS).toISOString(),
            shift: 'day',
            dateKey: CURRENT_RECORD_DATE,
            elevated: true,
          })
      );
    });

    it('blocks users from updating receipts with unexpected fields after creation', async () => {
      await setupDoc(admin(), receiptPath, {
        userId: 'user_nurse',
        userName: 'Nurse',
        readAt: new Date(NOW_MS).toISOString(),
        shift: 'day',
        dateKey: CURRENT_RECORD_DATE,
      });

      await assertFails(
        nurse().doc(receiptPath).update({
          elevated: true,
        })
      );
    });

    it('allows users to read their own receipt but blocks other users', async () => {
      await setupDoc(admin(), receiptPath, {
        userId: 'user_nurse',
        userName: 'Nurse',
        readAt: new Date(NOW_MS).toISOString(),
        shift: 'day',
        dateKey: CURRENT_RECORD_DATE,
      });

      await assertSucceeds(nurse().doc(receiptPath).get());
      await assertFails(doctor().doc(receiptPath).get());
    });

    it('allows only admins to read aggregated receipts for any user', async () => {
      await setupDoc(admin(), receiptPath, {
        userId: 'user_nurse',
        userName: 'Nurse',
        readAt: new Date(NOW_MS).toISOString(),
        shift: 'day',
        dateKey: CURRENT_RECORD_DATE,
      });

      await assertSucceeds(admin().doc(receiptPath).get());
    });
  });

  describe('Settings Collection', () => {
    const settingsPath = 'hospitals/H1/settings/tableConfig';
    const aiProviderRoutingPath = 'hospitals/H1/settings/aiProviderRouting';
    const rayenImportPolicyPath = 'hospitals/H1/settings/rayenImportPolicy';
    const rayenPolicy = (
      revision: number,
      updatedByUid = 'user_admin',
      mode: 'preview' | 'auto' = 'preview'
    ) => ({
      schemaVersion: 1,
      mode,
      revision,
      updatedAt: serverTimestamp(),
      updatedByUid,
    });

    it('Admins can write settings', async () => {
      await assertSucceeds(admin().doc(settingsPath).set({ foo: 'bar' }));
    });

    it('Regular users CANNOT write settings', async () => {
      await assertFails(authed().doc(settingsPath).set({ foo: 'bar' }));
    });

    it('Nurses can write settings', async () => {
      await assertSucceeds(nurse().doc(settingsPath).set({ foo: 'bar' }));
    });

    it('Only admins can write AI provider routing settings', async () => {
      await assertSucceeds(
        admin()
          .doc(aiProviderRoutingPath)
          .set({
            actions: {
              clinical_document_import: {
                enabled: true,
                provider: 'deepseek',
              },
            },
          })
      );

      await assertFails(
        nurse()
          .doc(aiProviderRoutingPath)
          .set({
            actions: {
              clinical_document_import: {
                enabled: true,
                provider: 'gemini',
              },
            },
          })
      );
    });

    it('Only admins can create the strict global Rayen import policy', async () => {
      await assertSucceeds(
        admin()
          .doc(rayenImportPolicyPath)
          .set(rayenPolicy(1, 'user_admin', 'auto'))
      );
      await assertFails(nurse().doc(rayenImportPolicyPath).set(rayenPolicy(1, 'user_nurse')));
    });

    it('Requires sequential Rayen policy revisions and the authenticated actor', async () => {
      await setupDoc(admin(), rayenImportPolicyPath, rayenPolicy(1));
      await assertSucceeds(
        admin()
          .doc(rayenImportPolicyPath)
          .set(rayenPolicy(2, 'user_admin', 'auto'))
      );
      await assertFails(admin().doc(rayenImportPolicyPath).set(rayenPolicy(4)));
      await assertFails(admin().doc(rayenImportPolicyPath).set(rayenPolicy(3, 'another-admin')));
      await assertFails(admin().doc(rayenImportPolicyPath).delete());
    });

    it('Rejects caller-supplied Rayen policy timestamps on create and update', async () => {
      await assertFails(
        admin()
          .doc(rayenImportPolicyPath)
          .set({ ...rayenPolicy(1), updatedAt: new Date(0) })
      );

      await setupDoc(admin(), rayenImportPolicyPath, rayenPolicy(1));
      await assertFails(
        admin()
          .doc(rayenImportPolicyPath)
          .set({ ...rayenPolicy(2), updatedAt: new Date(0) })
      );
    });

    it('Rejects malformed or expanded Rayen import policies', async () => {
      await assertFails(
        admin()
          .doc(rayenImportPolicyPath)
          .set({ ...rayenPolicy(1), mode: 'unsafe-auto' })
      );
      await assertFails(
        admin()
          .doc(rayenImportPolicyPath)
          .set({ ...rayenPolicy(1), unexpected: true })
      );
    });

    it('Unauthenticated users cannot read settings', async () => {
      await assertFails(unauth().doc(settingsPath).get());
    });
  });
}
