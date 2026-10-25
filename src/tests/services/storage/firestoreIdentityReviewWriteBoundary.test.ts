import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  txGet: vi.fn(),
  txSet: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({ id: 'synthetic-record' })),
  collection: vi.fn(() => ({ id: 'synthetic-collection' })),
  runTransaction: firestore.runTransaction,
  updateDoc: firestore.updateDoc,
  setDoc: firestore.setDoc,
  getDoc: firestore.getDoc,
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({}), ready: Promise.resolve() },
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<
    typeof import('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting')
  >()),
  assertDailyRecordClinicalAuthority: () => undefined,
  resolveAuthenticatedDailyRecordAuthorityMode: async () => null,
  shouldRouteDailyRecordSaveViaCallable: async () => false,
  tryShadowDailyRecordSaveViaCallable: async () => undefined,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', async original => ({
  ...(await original<
    typeof import('@/services/storage/firestore/dailyRecordAuthorityCallableClient')
  >()),
  saveDailyRecordWithClinicalAuthorityCallable: vi.fn(),
  patchDailyRecordWithClinicalAuthorityCallable: vi.fn(),
}));

import {
  moveRecordToTrash,
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import {
  patchDailyRecordWithClinicalAuthorityCallable,
  saveDailyRecordWithClinicalAuthorityCallable,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

type Json = Record<string, unknown>;

const reviewedDay = () => docToRecord(storedDay(), DATE);

/** R1 as storage held it: the unreadable document type, the rest as read, and no review. */
const expectR1AsStored = (written: Json) => {
  const r1 = (written.beds as Record<string, Json>).R1;
  expect(r1).toMatchObject({
    documentType: 'Cedula',
    patientName: 'PACIENTE UNO',
    rut: 'FAKE-PASSPORT-R1',
  });
  expect(JSON.stringify(written)).not.toContain('identityReview');
};

const expectNothingSent = () => {
  Object.values(firestore).forEach(call => expect(call).not.toHaveBeenCalled());
  expect(saveDailyRecordWithClinicalAuthorityCallable).not.toHaveBeenCalled();
  expect(patchDailyRecordWithClinicalAuthorityCallable).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  firestore.txGet.mockResolvedValue({ exists: () => false });
  firestore.runTransaction.mockImplementation(async (_db, callback) =>
    callback({ get: firestore.txGet, set: firestore.txSet })
  );
});

describe('the Firestore write boundary', () => {
  it('writes a full day with the reviewed bed exactly as storage held it', async () => {
    await saveRecordToFirestore(reviewedDay());

    const [, written] = firestore.txSet.mock.calls[0];
    expectR1AsStored(written);
    expect((written.beds as Record<string, Json>).R2.documentType).toBe('RUT');
  });

  it('archives the reviewed day in the trash exactly as storage held it', async () => {
    await moveRecordToTrash(reviewedDay());

    const [, archived] = firestore.setDoc.mock.calls[0];
    expectR1AsStored(archived);
  });

  it('refuses a patch of the review itself, which would erase what could not be read', async () => {
    const patch = { 'beds.R1.identityReview': undefined } as unknown as DailyRecordPatch;

    await expect(updateRecordPartial(DATE, patch)).rejects.toMatchObject({
      code: 'patient_identity_repair_required',
      bedId: 'R1',
    });
    expectNothingSent();
  });

  it('refuses a movement snapshot that copies the reviewed patient', async () => {
    const day = reviewedDay();
    const patch = {
      discharges: [DataFactory.createMockDischarge({ originalData: day.beds.R1 })],
    } as DailyRecordPatch;

    await expect(updateRecordPartial(DATE, patch)).rejects.toMatchObject({
      code: 'patient_identity_repair_required',
      message: 'Identidad de la cama R1 por revisar.',
    });
    expectNothingSent();
  });
});
