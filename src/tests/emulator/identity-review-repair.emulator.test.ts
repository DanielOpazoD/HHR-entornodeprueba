// @vitest-environment jsdom
import * as fs from 'node:fs';
import * as path from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { resolveFirestoreRulesEmulatorConfig } from '@/tests/security/firestoreRulesEmulatorConfig';
import { storedDay } from '@/tests/fixtures/identityReviewDayFixture';

const enabled =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ||
  process.env.FIRESTORE_EMULATOR_HOST !== undefined;

let activeDb: unknown;
vi.mock('@/firebaseConfig', () => ({
  get db() {
    return activeDb;
  },
  auth: null,
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'client_only',
  isServerClinicalWriteFenceActive: async () => false,
}));
vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logPatientView: vi.fn() }),
}));

import { useDemographicsLogic } from '@/components/modals/demographics/useDemographicsLogic';
import { buildUpdatePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import {
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { sanitizeForFirestore } from '@/services/storage/firestore/firestoreShared';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getTodayISO } from '@/utils/dateCoreUtils';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

type Json = Record<string, unknown>;

const date = getTodayISO();
const storedAt = `${date}T08:00:00.000Z`;
const docPath = `hospitals/hanga_roa/dailyRecords/${date}`;

type Form = ReturnType<typeof useDemographicsLogic>;

describe.skipIf(!enabled)('repairing one identity field of a stored day under review', () => {
  let environment: RulesTestEnvironment;

  const storedR1 = async (): Promise<Json> => {
    let bed: Json = {};
    await environment.withSecurityRulesDisabled(async context => {
      const data = (await context.firestore().doc(docPath).get()).data() ?? {};
      bed = (data.beds as Record<string, Json>).R1;
    });
    return bed;
  };
  const storeR1 = (r1: Json) =>
    environment.withSecurityRulesDisabled(async context => {
      const day = storedDay(r1, { date, lastUpdated: storedAt });
      await context
        .firestore()
        .doc(docPath)
        .set(sanitizeForFirestore(day) as Json);
    });

  /** The demographics form of R1 as read from Firestore, after an edit and a save. */
  const submitForm = async (edit: (form: Form) => void) => {
    const day = (await getRecordFromFirestore(date))!;
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useDemographicsLogic({
        data: day.beds.R1,
        isClinicalCribPatient: false,
        isOpen: true,
        bedId: 'R1',
        recordDate: date,
        onSave,
        onClose: vi.fn(),
      })
    );
    act(() => edit(result.current));
    act(() => result.current.handleSave());
    return { day, onSave, error: result.current.error };
  };

  /** Saves the form as the census does: its patch to Firestore, then a full save of the day. */
  const saveForm = async (edit: (form: Form) => void) => {
    const { day, onSave } = await submitForm(edit);
    const patch = buildUpdatePatientPatches(day, 'R1', onSave.mock.calls[0][0]);
    const { record, mergedPatches } = preparePatchedRecordPersistence(
      day,
      date,
      patch as DailyRecordPatch
    );
    await updateRecordPartial(date, mergedPatches, storedAt);
    const afterPatch = await storedR1();
    const { lastUpdated } = (await getRecordFromFirestore(date))!;
    await saveRecordToFirestore({ ...record, lastUpdated }, lastUpdated);
    return { afterPatch, afterFullSave: await storedR1() };
  };

  beforeAll(async () => {
    const { host, port } = resolveFirestoreRulesEmulatorConfig(process.env.FIRESTORE_EMULATOR_HOST);
    environment = await initializeTestEnvironment({
      projectId: 'demo-hhr-identity-review-repair',
      firestore: {
        host,
        port,
        rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearFirestore();
    activeDb = environment
      .authenticatedContext('synthetic-admin', {
        email: 'synthetic-admin@example.invalid',
        role: 'admin',
      })
      .firestore();
    setFirestoreEnabled(true);
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it('stores only the document type the nurse chose and keeps the unread name', async () => {
    // R1's document type and full name are both unreadable as stored.
    await storeR1({ documentType: 'Cedula', patientName: { full: 'FAKE-NAME' } });

    const saved = await saveForm(form =>
      form.setLocalData(current => ({ ...current, documentType: 'Pasaporte' }))
    );

    for (const r1 of [saved.afterPatch, saved.afterFullSave]) {
      expect(r1).toMatchObject({ documentType: 'Pasaporte', patientName: { full: 'FAKE-NAME' } });
    }
  });

  it('stores the full name composed from its parts when the nurse edits one', async () => {
    await storeR1({ documentType: 'Cedula', patientName: { full: 'FAKE-NAME' } });

    const saved = await saveForm(form =>
      form.setLocalData(current => ({ ...current, lastName: 'SINTETICA' }))
    );

    for (const r1 of [saved.afterPatch, saved.afterFullSave]) {
      expect(r1).toMatchObject({
        patientName: 'PACIENTE SINTETICA R1',
        firstName: 'PACIENTE',
        lastName: 'SINTETICA',
        secondLastName: 'R1',
        // Not edited, so still as stored and under review.
        documentType: 'Cedula',
      });
    }
  });

  it('stores nothing while another part of the name is unread', async () => {
    await storeR1({ firstName: { given: 'PACIENTE' } });
    const before = await storedR1();

    const { onSave, error } = await submitForm(form =>
      form.setLocalData(current => ({ ...current, lastName: 'SINTETICA' }))
    );

    expect(onSave).not.toHaveBeenCalled();
    expect(error).toBe('Completa el nombre: una parte no se pudo leer.');
    expect(await storedR1()).toEqual(before);
  });
});
