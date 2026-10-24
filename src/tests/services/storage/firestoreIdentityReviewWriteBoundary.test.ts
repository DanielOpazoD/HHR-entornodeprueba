import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  runTransaction: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({ id: 'synthetic-record' })),
  collection: vi.fn(() => ({ id: 'synthetic-collection' })),
  ...firestore,
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
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

const refused = expect.objectContaining({
  code: 'patient_identity_repair_required',
  message: 'Identidad de la cama R1 por revisar: tipo de documento.',
});

const expectNothingSent = () => {
  Object.values(firestore).forEach(call => expect(call).not.toHaveBeenCalled());
  expect(saveDailyRecordWithClinicalAuthorityCallable).not.toHaveBeenCalled();
  expect(patchDailyRecordWithClinicalAuthorityCallable).not.toHaveBeenCalled();
};

beforeEach(() => vi.clearAllMocks());

describe('the Firestore write boundary', () => {
  const reviewedDay = () => docToRecord(storedDay(), DATE);

  it('never sends a full day that holds a bed under identity review', async () => {
    await expect(saveRecordToFirestore(reviewedDay())).rejects.toEqual(refused);
    expectNothingSent();
  });

  it('never sends a patch that copies the reviewed patient whole', async () => {
    const patch = { 'beds.R4': { ...reviewedDay().beds.R1, bedId: 'R4' } } as DailyRecordPatch;

    await expect(updateRecordPartial(DATE, patch)).rejects.toEqual(refused);
    expectNothingSent();
  });

  it('never archives the reviewed day in the trash as if it had been read', async () => {
    await expect(moveRecordToTrash(reviewedDay())).rejects.toEqual(refused);
    expectNothingSent();
  });
});
