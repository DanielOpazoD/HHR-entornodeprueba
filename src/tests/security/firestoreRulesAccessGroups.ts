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
  setupDocBypass,
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

    const ownEvent = { action: 'TEST_ACTION', timestamp: 123456 };
    const userBasic = { userId: 'user@example.com', userUid: 'user_basic' };

    it('Configured admins can read audit logs without an admin claim', async () => {
      await setupDocBypass('hospitals/H1/auditLogs/log-dynamic-admin', { action: 'TEST' });
      await assertSucceeds(auditCollection(adminWithoutClaim()).get());
    });

    it('A signed-in user can record an audit event in their own name', async () => {
      await assertSucceeds(auditCollection(authed()).add({ ...ownEvent, ...userBasic }));
      // The email is compared without regard to case.
      await assertSucceeds(
        auditCollection(authed()).add({ ...ownEvent, ...userBasic, userId: 'User@Example.com' })
      );
    });

    it('Nobody records an audit event in another person’s name or without one', async () => {
      const db = authed();
      await assertFails(
        auditCollection(db).add({ ...ownEvent, ...userBasic, userUid: 'user_admin' })
      );
      await assertFails(
        auditCollection(db).add({
          ...ownEvent,
          ...userBasic,
          userId: 'daniel.opazo@hospitalhangaroa.cl',
        })
      );
      await assertFails(auditCollection(db).add({ ...ownEvent, userId: userBasic.userId }));
      await assertFails(auditCollection(db).add({ ...ownEvent, userUid: userBasic.userUid }));
      await assertFails(auditCollection(db).add(ownEvent));
    });

    it('Authenticated users without an effective role cannot create audit logs', async () => {
      await assertFails(
        auditCollection(unauthorizedAuthed()).add({
          ...ownEvent,
          userId: 'outsider@example.com',
          userUid: 'user_outsider',
        })
      );
    });

    it('Regular users CANNOT delete audit logs', async () => {
      const db = authed();
      await setupDocBypass('hospitals/H1/auditLogs/log1', { action: 'TEST' });
      await assertFails(db.doc('hospitals/H1/auditLogs/log1').delete());
    });

    it('Admins CANNOT delete audit logs (append-only policy)', async () => {
      const db = admin();
      await setupDocBypass('hospitals/H1/auditLogs/log1', { action: 'TEST' });
      await assertFails(db.doc('hospitals/H1/auditLogs/log1').delete());
    });

    it('Admins CANNOT update audit logs (append-only policy)', async () => {
      const db = admin();
      await setupDocBypass('hospitals/H1/auditLogs/log1', { action: 'TEST' });
      await assertFails(db.doc('hospitals/H1/auditLogs/log1').update({ action: 'TAMPERED' }));
    });
  });

  describe('Daily Records Collection', () => {
    const recordPath = `hospitals/H1/dailyRecords/${CURRENT_RECORD_DATE}`;
    const historyPath = `hospitals/H1/dailyRecords/${CURRENT_RECORD_DATE}/history/h-1`;

    const nurseChange = { nursesDayShift: ['SYNTHETIC'] };

    it('Nurses cannot reopen historical records by replacing the persisted timestamp', async () => {
      const path = 'hospitals/H1/dailyRecords/2001-01-01';
      await setupDoc(admin(), path, {
        date: '2001-01-01',
        dateTimestamp: Date.parse('2001-01-01T00:00:00Z'),
      });
      await assertFails(
        nurse()
          .doc(path)
          .update({ ...nurseChange, dateTimestamp: NOW_MS })
      );
    });

    it('Nurses cannot edit historical legacy records with missing or null timestamps', async () => {
      for (const dateTimestamp of [undefined, null]) {
        const path = 'hospitals/H1/dailyRecords/2001-01-01';
        await setupDoc(admin(), path, {
          date: '2001-01-01',
          ...(dateTimestamp === undefined ? {} : { dateTimestamp }),
        });
        await assertFails(nurse().doc(path).update(nurseChange));
        await assertFails(
          nurse()
            .doc(path)
            .update({ ...nurseChange, dateTimestamp: NOW_MS })
        );
        await assertFails(
          nurse()
            .doc(path)
            .update({ ...nurseChange, dateTimestamp: NOW_MS, date: CURRENT_RECORD_DATE })
        );
      }
    });

    it('Nurses repair current legacy records with a timestamp matching the document date', async () => {
      for (const dateTimestamp of [undefined, null]) {
        await setupDoc(admin(), recordPath, {
          date: CURRENT_RECORD_DATE,
          ...(dateTimestamp === undefined ? {} : { dateTimestamp }),
        });
        await assertSucceeds(
          nurse()
            .doc(recordPath)
            .update({ ...nurseChange, dateTimestamp: NOW_MS })
        );
      }
    });

    it('Nurses cannot repair a legacy timestamp with an invalid type or an unrelated date', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE });
      for (const dateTimestamp of [null, String(NOW_MS), NOW_MS + 0.5, NOW_MS - THREE_DAYS_MS]) {
        await assertFails(
          nurse()
            .doc(recordPath)
            .update({ ...nurseChange, dateTimestamp })
        );
      }
    });

    it('Nurses cannot move the immutable timestamp within the same record day', async () => {
      await setupDoc(admin(), recordPath, { date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS });
      await assertFails(
        nurse()
          .doc(recordPath)
          .update({ dateTimestamp: NOW_MS + 1 })
      );
    });

    it('Nurses cannot repair legacy records with a persisted date/path mismatch', async () => {
      await setupDoc(admin(), recordPath, { date: PREVIOUS_RECORD_DATE });
      await assertFails(
        nurse()
          .doc(recordPath)
          .update({ ...nurseChange, dateTimestamp: NOW_MS })
      );
    });

    it('Configured admins retain historical timestamp repair access', async () => {
      const path = 'hospitals/H1/dailyRecords/2001-01-01';
      await setupDoc(admin(), path, { date: '2001-01-01', dateTimestamp: null });
      await assertSucceeds(adminWithoutClaim().doc(path).update({ dateTimestamp: NOW_MS }));
    });

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

    it('fences direct bed writes from stale clients when clinical batching is enforced', async () => {
      await setupDocBypass('hospitals/H1/settings/rayenImportPolicy', {
        schemaVersion: 2,
        mode: 'preview',
        clinicalBatchMode: 'enforced',
      });
      await setupDocBypass(recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: {
          H2C1: {
            bedId: 'H2C1',
            clinicalEpisodeId: 'ep_current',
            vitalSigns: { heartRate: 70 },
          },
        },
      });

      await assertFails(
        nurse()
          .doc(recordPath)
          .update({
            beds: {
              H2C1: {
                bedId: 'H2C1',
                clinicalEpisodeId: 'ep_current',
                vitalSigns: { heartRate: 120 },
              },
            },
          })
      );
    });

    it('fences direct bed clients only with server-owned specialty policy', async () => {
      await setupDocBypass('hospitals/H1/settings/specialtyAssignment', {
        schemaVersion: 1,
        revision: 99,
        autoEnabled: true,
        memoryEnabled: false,
        aiMode: 'off',
        rules: [],
        memory: [],
      });
      await setupDocBypass(recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        beds: { R1: { bedId: 'R1', clinicalEpisodeId: 'synthetic-episode', specialty: 'Cirugía' } },
      });
      await assertSucceeds(
        nurse()
          .doc(recordPath)
          .update({
            beds: {
              R1: { bedId: 'R1', clinicalEpisodeId: 'synthetic-episode', specialty: 'Pediatría' },
            },
          })
      );
      await assertFails(
        admin().doc('hospitals/H1/specialtyPolicies/active').set({ schemaVersion: 1, revision: 1 })
      );
      await setupDocBypass('hospitals/H1/specialtyPolicies/active', {
        schemaVersion: 1,
        revision: 1,
        autoEnabled: false,
        memoryEnabled: false,
        aiMode: 'off',
        rules: [],
        memory: [],
      });
      await assertFails(
        nurse()
          .doc(recordPath)
          .update({
            beds: {
              R1: { bedId: 'R1', clinicalEpisodeId: 'synthetic-episode', specialty: 'Cirugía' },
            },
          })
      );
      await assertFails(
        admin().doc('hospitals/H1/specialtyPolicies/active').update({ autoEnabled: true })
      );
      await assertFails(
        admin().doc('hospitals/H1/settings/specialtyAssignment').update({ autoEnabled: false })
      );
      await assertFails(
        nurse().doc(`${recordPath}/specialtyDecisions/decision-1`).set({ source: 'manual' })
      );
      await assertFails(
        nurse().doc('hospitals/H1/specialtyAiRequests/request-1').set({ status: 'complete' })
      );
    });

    it('keeps non-clinical staffing edits available while clinical batching is enforced', async () => {
      await setupDocBypass('hospitals/H1/settings/rayenImportPolicy', {
        schemaVersion: 2,
        mode: 'preview',
        clinicalBatchMode: 'enforced',
      });
      await setupDocBypass(recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
      });

      await assertSucceeds(
        nurse()
          .doc(recordPath)
          .update({ nursesDayShift: ['Nurse Authority'] })
      );
    });

    it.each(['off', 'shadow', 'enforced'] as const)(
      'blocks direct daily-record creation after schema-v2 migration in %s mode',
      async clinicalBatchMode => {
        await setupDocBypass('hospitals/H1/settings/rayenImportPolicy', {
          schemaVersion: 2,
          mode: 'preview',
          clinicalBatchMode,
        });

        await assertFails(
          nurse()
            .doc(recordPath)
            .set({ date: CURRENT_RECORD_DATE, dateTimestamp: NOW_MS, beds: {} })
        );
      }
    );

    it.each(['off', 'shadow'] as const)(
      'keeps direct bed writes fenced after rollback to %s',
      async clinicalBatchMode => {
        await setupDocBypass('hospitals/H1/settings/rayenImportPolicy', {
          schemaVersion: 2,
          mode: 'preview',
          clinicalBatchMode,
        });
        await setupDocBypass(recordPath, {
          date: CURRENT_RECORD_DATE,
          dateTimestamp: NOW_MS,
          beds: {
            H2C1: {
              bedId: 'H2C1',
              clinicalEpisodeId: 'ep_current',
              vitalSigns: { heartRate: 70 },
            },
          },
        });

        await assertFails(
          nurse()
            .doc(recordPath)
            .update({
              beds: {
                H2C1: {
                  bedId: 'H2C1',
                  clinicalEpisodeId: 'ep_current',
                  vitalSigns: { heartRate: 120 },
                },
              },
            })
        );
      }
    );

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

    it('Doctor roles keep reading a day with old medical notes and signatures but never write it', async () => {
      await setupDoc(admin(), recordPath, {
        date: CURRENT_RECORD_DATE,
        dateTimestamp: NOW_MS,
        medicalSignature: { doctorName: 'Médico Sintético' },
        medicalHandoffBySpecialty: { cirugia: { note: 'Nota previa sintética' } },
        beds: {
          R1: {
            patientName: 'Paciente Sintético',
            medicalHandoffNote: 'Nota previa',
            medicalHandoffEntries: [],
            clinicalEvents: [],
          },
        },
      });
      const oldWrites = [
        { medicalSignature: { doctorName: 'Otro' }, lastUpdated: NOW_MS },
        { 'beds.R1.medicalHandoffNote': 'Nota nueva', lastUpdated: NOW_MS },
        { 'beds.R1.clinicalEvents': [{ id: 'ev-1' }], lastUpdated: NOW_MS },
        { 'medicalHandoffBySpecialty.cirugia.note': 'Nota nueva', lastUpdated: NOW_MS },
        { nursesDayShift: ['Nurse1'] },
      ];

      for (const client of [doctor(), specialist(), specialistWithoutClaim()]) {
        await assertSucceeds(client.doc(recordPath).get());
        for (const change of oldWrites) {
          await assertFails(client.doc(recordPath).update(change));
        }
      }
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
      mode: 'preview' | 'auto' = 'preview',
      clinicalBatchMode: 'off' | 'shadow' | 'enforced' = 'enforced'
    ) => ({
      schemaVersion: 2,
      mode,
      clinicalBatchMode,
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
      await assertSucceeds(admin().doc(rayenImportPolicyPath).set(rayenPolicy(1)));
      await assertFails(nurse().doc(rayenImportPolicyPath).set(rayenPolicy(1, 'user_nurse')));
    });

    it('Requires sequential Rayen policy revisions and the authenticated actor', async () => {
      await setupDoc(admin(), rayenImportPolicyPath, rayenPolicy(1));
      await assertSucceeds(admin().doc(rayenImportPolicyPath).set(rayenPolicy(2)));
      await assertFails(admin().doc(rayenImportPolicyPath).set(rayenPolicy(4)));
      await assertFails(admin().doc(rayenImportPolicyPath).set(rayenPolicy(3, 'another-admin')));
      await assertFails(admin().doc(rayenImportPolicyPath).delete());
    });

    it('Allows an admin to migrate a legacy v1 policy to the strict v2 contract', async () => {
      await setupDocBypass(rayenImportPolicyPath, {
        schemaVersion: 1,
        mode: 'auto',
        revision: 3,
        updatedAt: new Date(0),
        updatedByUid: 'legacy-admin',
      });

      await assertSucceeds(admin().doc(rayenImportPolicyPath).set(rayenPolicy(4)));
    });

    it('Rejects retired auto import policy on create and update', async () => {
      await assertFails(
        admin()
          .doc(rayenImportPolicyPath)
          .set(rayenPolicy(1, 'user_admin', 'auto'))
      );
      await setupDocBypass(rayenImportPolicyPath, rayenPolicy(1));
      await assertFails(
        admin()
          .doc(rayenImportPolicyPath)
          .set(rayenPolicy(2, 'user_admin', 'auto'))
      );
    });

    it.each(['off', 'shadow'] as const)(
      'Rejects retired clinical policy mode %s on create and update',
      async mode => {
        await assertFails(
          admin()
            .doc(rayenImportPolicyPath)
            .set(rayenPolicy(1, 'user_admin', 'preview', mode))
        );
        await setupDocBypass(rayenImportPolicyPath, rayenPolicy(1));
        await assertFails(
          admin()
            .doc(rayenImportPolicyPath)
            .set(rayenPolicy(2, 'user_admin', 'preview', mode))
        );
      }
    );

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
          .set({ ...rayenPolicy(1), clinicalBatchMode: 'fallback' })
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
