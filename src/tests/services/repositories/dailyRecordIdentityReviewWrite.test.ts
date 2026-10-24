// Real repository write service, real validation, fake IndexedDB and the real outbox; only the
// Firestore write layer is replaced by the authority answer, which echoes the stored day.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn(() => ({ __ref: 'doc' })),
    collection: vi.fn(() => ({ __ref: 'collection' })),
    getDoc: vi.fn(),
    getDocFromServer: vi.fn(),
    onSnapshot: vi.fn(),
  };
});
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
  deleteRecordFromFirestore: vi.fn(),
  moveRecordToTrash: vi.fn(),
}));

import { getDoc, getDocFromServer } from 'firebase/firestore';
import {
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  getRecordForDate,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { buildMovePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { buildDischargeEntries } from '@/features/census/controllers/patientMovementDischargeMutationController';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  IDENTITY_REVIEW_DATE as DATE,
  storedDay,
  storedSnapshot,
} from '@/tests/fixtures/identityReviewDayFixture';

type Json = Record<string, unknown>;

const R1_BLOCKED = 'Identidad de la cama R1 por revisar: tipo de documento.';
const COMMITTED_AT = `${DATE}T09:00:00.000Z`;

/** The stored day after the server applied a patch: R1 keeps its unreadable value. */
const serverDayAfter = (beds: Record<string, Json>) => {
  const day = storedDay(undefined, { lastUpdated: COMMITTED_AT });
  const storedBeds = day.beds as Record<string, Json>;
  Object.entries(beds).forEach(([bedId, fields]) => {
    storedBeds[bedId] = { ...storedBeds[bedId], ...fields };
  });
  return { ...day, meta: { revision: 5, lastMutationId: 'mut-1', updatedAt: COMMITTED_AT } };
};

const authorityAnswer = (record: Json) => {
  vi.mocked(updateRecordPartial).mockResolvedValue({
    success: true,
    date: DATE,
    mode: 'enforced',
    authorityStatus: 'ok',
    revision: 5,
    mutationId: 'mut-1',
    violations: [],
    recordState: { lastUpdated: COMMITTED_AT, meta: record.meta, record },
  } as never);
  vi.mocked(getDoc).mockResolvedValue(storedSnapshot(record) as never);
  vi.mocked(getDocFromServer).mockResolvedValue(storedSnapshot(record) as never);
};

const sentPatchKeys = (): string[] =>
  Object.keys(vi.mocked(updateRecordPartial).mock.calls[0]?.[1] ?? {});

const outbox = () => hospitalDB.syncQueue.toArray();

beforeEach(async () => {
  vi.clearAllMocks();
  setFirestoreEnabled(true);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  // This device already read the day: its copy holds R1 under review.
  const seeded = await saveRecordStrict(docToRecord(storedDay(), DATE));
  expect(seeded.ok).toBe(true);
});

describe('field edits on a day with one bed under identity review', () => {
  it('saves an edit of another bed cleanly and leaves the outbox empty', async () => {
    authorityAnswer(serverDayAfter({ R2: { pathology: 'DIAGNOSTICO EDITADO' } }));

    const result = await updatePartialDetailed(DATE, {
      'beds.R2.pathology': 'DIAGNOSTICO EDITADO',
    } as DailyRecordPatch);
    const local = await getRecordForDate(DATE);

    expect(result.outcome).toBe('clean');
    expect(sentPatchKeys().some(key => key.startsWith('beds.R1'))).toBe(false);
    expect(await outbox()).toEqual([]);
    expect(local?.beds.R2.pathology).toBe('DIAGNOSTICO EDITADO');
    expect(local?.beds.R1.identityReview?.fields).toEqual(['documentType']);
    expect(local?.beds.R1.documentType).toBeUndefined();
  });

  it('saves a clinical edit of the reviewed bed without writing anything derived from its identity', async () => {
    authorityAnswer(serverDayAfter({ R1: { pathology: 'DIAGNOSTICO R1 EDITADO' } }));

    const result = await updatePartialDetailed(DATE, {
      'beds.R1.pathology': 'DIAGNOSTICO R1 EDITADO',
    } as DailyRecordPatch);

    expect(result.outcome).toBe('clean');
    expect(sentPatchKeys().filter(key => key.startsWith('beds.R1'))).toEqual(['beds.R1.pathology']);
    expect(await outbox()).toEqual([]);
    expect((await getRecordForDate(DATE))?.beds.R1.identityReview?.fields).toEqual([
      'documentType',
    ]);
  });

  it('keeps an offline repair of the document type queued and ends the review locally', async () => {
    vi.mocked(updateRecordPartial).mockRejectedValue(
      Object.assign(new Error('Failed to fetch'), { code: 'unavailable' })
    );

    const result = await updatePartialDetailed(DATE, {
      'beds.R1.documentType': 'Pasaporte',
    } as DailyRecordPatch);
    const local = await getRecordForDate(DATE);
    const [task] = await outbox();

    expect(result.savedLocally).toBe(true);
    expect(result.updatedRemotely).toBe(false);
    expect(local?.beds.R1.documentType).toBe('Pasaporte');
    expect(local?.beds.R1.identityReview).toBeUndefined();
    expect(task?.syncContract?.changedPaths).toEqual(['beds.R1.documentType']);
  });

  it('refuses an identity value that still cannot be read', async () => {
    const result = await updatePartialDetailed(DATE, {
      'beds.R1.documentType': 'Cedula',
    } as unknown as DailyRecordPatch);

    expect(result.outcome).toBe('blocked');
    expect(result.userSafeMessage).toBe(R1_BLOCKED);
    expect(updateRecordPartial).not.toHaveBeenCalled();
    expect(await outbox()).toEqual([]);
  });
});

describe('writes that copy the reviewed bed whole', () => {
  const expectRefusedUntouched = async (result: { outcome: string; userSafeMessage?: string }) => {
    expect(result.outcome).toBe('blocked');
    expect(result.userSafeMessage).toBe(R1_BLOCKED);
    expect(updateRecordPartial).not.toHaveBeenCalled();
    expect(saveRecordToFirestore).not.toHaveBeenCalled();
    expect(await outbox()).toEqual([]);
    const local = await getRecordForDate(DATE);
    expect(local?.beds.R1.patientName).toBe('PACIENTE UNO');
    expect(local?.beds.R1.identityReview?.fields).toEqual(['documentType']);
  };

  it('refuses a full save of the day', async () => {
    const local = await getRecordForDate(DATE);

    await expectRefusedUntouched(await saveDetailed(local!));
  });

  it('refuses moving the patient to another bed', async () => {
    const local = await getRecordForDate(DATE);

    await expectRefusedUntouched(
      await updatePartialDetailed(DATE, buildMovePatientPatches(local!, 'R1', 'R4'))
    );
  });

  it('refuses a discharge, whose snapshot would copy the identity', async () => {
    const local = await getRecordForDate(DATE);
    const { discharges } = buildDischargeEntries({
      patient: local!.beds.R1,
      bedId: 'R1',
      payload: { status: 'Vivo', type: 'Domicilio (Habitual)', time: '13:24' },
      resolvedMovementDate: DATE,
      createId: () => 'discharge-synthetic-r1',
    });

    await expectRefusedUntouched(
      await updatePartialDetailed(DATE, { discharges } as DailyRecordPatch)
    );
  });
});
