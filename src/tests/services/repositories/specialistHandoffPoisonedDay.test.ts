/* Synthetic-only: an unresolved handoff queue task vs. later ordinary writes on the same device and date. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ remoteCalls: [] as unknown[] }));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordWrites')>()),
  updateRecordPartial: vi.fn(async (...args: unknown[]) => {
    h.remoteCalls.push(args[1]);
  }),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestore: vi.fn(async () => null),
}));
vi.mock(
  '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting')
    >()),
    shouldRouteSpecialistPatchViaCallable: vi.fn(async () => false),
  })
);
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: vi.fn(() => true),
}));
import { hospitalDB } from '@/services/storage/indexedDBService';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { DataFactory } from '@/tests/factories/DataFactory';

const DATE = '2026-10-24';
const pt = (bed: string, name: string, extra: Record<string, unknown> = {}) =>
  DataFactory.createMockPatient(bed, {
    patientName: name,
    rut: '99.999.999-9',
    documentType: 'RUT',
    admissionDate: '2026-10-20',
    medicalHandoffNote: '',
    ...extra,
  });
const rec = (r4: ReturnType<typeof pt>, lastUpdated: string) =>
  DataFactory.createMockDailyRecord(DATE, {
    lastUpdated,
    beds: {
      R4: r4,
      R5: pt('R5', 'Paciente C Sintético', { rut: '77.777.777-7', clinicalEpisodeId: 'ep-C' }),
    },
  });

beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
  h.remoteCalls = [];
});
describe('poisoned day', () => {
  it.each(['PENDING', 'CONFLICT'] as const)(
    'task %s for A@R4, then a nurse edit on R5 with B in R4',
    async status => {
      // Doctor (generic path) note for A that could not reach the server: pre-outbox task stays queued.
      const recA = rec(
        pt('R4', 'Paciente A Sintético', {
          clinicalEpisodeId: 'ep-A',
          medicalHandoffNote: 'Nota de A no sincronizada',
        }),
        '2026-10-24T10:00:00.000Z'
      );
      await queueDailyRecordSyncTaskWithLocalRecord(recA, {
        contexts: ['handoff'],
        origin: 'direct_queue',
        syncContract: {
          changedPaths: ['beds.R4.medicalHandoffNote'],
          expectedVersion: '2026-10-24T10:00:00.000Z',
          mutationId: 'm-A',
        },
      });
      const [task] = await hospitalDB.syncQueue.toArray();
      await hospitalDB.syncQueue.update(task.id!, { status });
      // Another device discharged A and admitted B; this device now holds B in R4.
      const recB = rec(
        pt('R4', 'Paciente B Sintético', { rut: '88.888.888-8', clinicalEpisodeId: 'ep-B' }),
        '2026-10-24T11:00:00.000Z'
      );
      let error: unknown = null;
      let result: Awaited<ReturnType<typeof updatePartialDetailed>> | null = null;
      try {
        result = await updatePartialDetailed(
          DATE,
          { 'beds.R5.pathology': 'Diagnóstico corregido C' },
          { baseRecord: recB }
        );
      } catch (e) {
        error = e;
      }
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(error).toBeNull();
      expect(result).toMatchObject({ savedLocally: true });
      expect(h.remoteCalls).toContainEqual(
        expect.objectContaining({ 'beds.R5.pathology': 'Diagnóstico corregido C' })
      );
      expect(tasks).toContainEqual(expect.objectContaining({ status: 'CONFLICT', payload: recA }));
      const stored = await hospitalDB.dailyRecords.get(DATE);
      expect(stored?.beds.R4.clinicalEpisodeId).toBe('ep-B');
      expect(stored?.beds.R5.pathology).toBe('Diagnóstico corregido C');
    }
  );
});
