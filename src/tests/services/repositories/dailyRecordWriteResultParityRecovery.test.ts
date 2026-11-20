import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { DataFactory } from '@/tests/factories/DataFactory';
import { baseDay, resetParityWorld } from './dailyRecordWriteResultParity.test-support';
import { server } from './dailyRecordWriteResultParityServer.test-support';
import { observePatchCase, type ParityCase } from './dailyRecordWriteResultParityView.test-support';

vi.mock('@/services/repositories/repositoryConfig', async () =>
  (await import('./dailyRecordWriteResultParityServer.test-support')).scriptedRepositoryConfig()
);
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async importOriginal =>
  (await import('./dailyRecordWriteResultParityServer.test-support')).scriptedFirestoreRecordWrites(
    importOriginal
  )
);
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal =>
  (
    await import('./dailyRecordWriteResultParityServer.test-support')
  ).scriptedFirestoreRecordQueries(importOriginal)
);
// The specialty consumer calls the write service itself: it gets the row's result once.
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/services/repositories/dailyRecordRepositoryWriteService')
    >();
  return { ...actual, updatePartialDetailed: vi.fn(actual.updatePartialDetailed) };
});
vi.mock('@/services/storage/firestore/dailyRecordConflictSnapshotService', () => ({
  buildConflictId: () => 'synthetic-conflict',
  saveConflictVersionSnapshots: async () => ({ saved: false }),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { getCurrentUser: () => ({ uid: 'synthetic-parity-A' }) },
}));

/**
 * W14-D1-1 — parity table, third part: the three recoveries the first tables left out, each
 * produced by the shipped repository and controllers under the mounted census mutation. Same
 * harness and columns as dailyRecordWriteResultParity.test.ts.
 */
const versionConflict = () =>
  new ConcurrencyError('synthetic version conflict', 'version_mismatch');
const clearedBed = () =>
  DataFactory.createMockPatient('R1', {
    patientName: '',
    rut: '',
    pathology: '',
    admissionDate: '',
    clinicalEpisodeId: '',
  });
/** Dexie refuses to store the day (a full disk or a closed database), as the real store would. */
const refuseLocalWrites = () => {
  const refuse = () => {
    throw new DOMException('synthetic quota', 'QuotaExceededError');
  };
  hospitalDB.dailyRecords.hook('creating', refuse);
  hospitalDB.dailyRecords.hook('updating', refuse);
  stopRefusing = () => {
    hospitalDB.dailyRecords.hook('creating').unsubscribe(refuse);
    hospitalDB.dailyRecords.hook('updating').unsubscribe(refuse);
  };
};
let stopRefusing = () => {};

export const RECOVERY_CASES: Record<string, ParityCase> = {
  // A patch that moves a patient between two movement lists may never be merged automatically.
  // Same disagreement as H1: notice and box say «local», the view reverts, the queue keeps it.
  'reclasificar un egreso que otro equipo cambió': {
    from: 'dailyRecordWriteConcurrencyRecoveryController.ts:30-41 (allowConflictAutoMerge=false)',
    answer: { kind: 'refuses', error: versionConflict },
    patch: {
      discharges: [],
      transfers: [DataFactory.createMockTransfer({ id: 'transfer-synthetic-reclassified' })],
    } as DailyRecordPatch,
    read: record => record?.transfers?.length,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'local',
      aviso:
        'Cambio local sin sincronización: El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: El egreso fue modificado por otro usuario. Recarga el censo antes de reclasificarlo.',
      repositorio: 'lanza ConcurrencyError: synthetic version conflict',
      ingreso: 'lanza ConcurrencyError: synthetic version conflict',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza ConcurrencyError: synthetic version conflict',
      },
      historico: 'durably_queued',
      rayen: 'lanza ConcurrencyError: synthetic version conflict',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOCHE BASE',
    },
  },
  // The send loses its race, but the server already holds exactly the cleared bed.
  'limpiar una cama: el servidor rechaza, pero ya la tenía limpia': {
    from: 'dailyRecordRemotePersistenceState.ts:69-124 (recoverAlreadyAppliedRemoteWrite)',
    answer: { kind: 'refuses', error: versionConflict },
    arrange: () =>
      (server.remoteDay = {
        ...baseDay(),
        lastUpdated: '2026-11-17T09:00:00.000Z',
        beds: { R1: clearedBed() },
      }),
    patch: { 'beds.R1': clearedBed() } as DailyRecordPatch,
    options: {
      requireRemoteAuthorityFirst: true,
      requireConfirmedRecord: true,
      intentionalBedClear: {
        bedId: 'R1',
        confirmedLastUpdated: baseDay().lastUpdated,
        confirmedOccupant: { clinicalEpisodeId: 'ep_synthetic_parity_R1' },
      },
    },
    authoritative: (): DailyRecord => baseDay(),
    read: record => record?.beds?.R1?.patientName,
    expected: {
      vista: 'conserva la edición',
      cuadro: 'saved',
      aviso: 'Cambio guardado: La actualización quedó confirmada en el servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: true,
        especialidad: 'confirmada',
      },
      historico: 'confirmed',
      rayen: 'sigue',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  // Disagree: box, notice and Rayen's history say confirmed; the flow throws and the view reverts.
  'el servidor confirma, pero este equipo no puede guardar su copia': {
    from: 'dailyRecordConfirmedLocalPersistence.ts:27-46 (remoteCommitted)',
    answer: { kind: 'accepts_with_receipt' },
    options: { requireRemoteAuthorityFirst: true, requireConfirmedRecord: true },
    // Server first touches Dexie only after the server confirmed.
    arrange: refuseLocalWrites,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'saved',
      aviso:
        'Cambio guardado; copia local pendiente: Los cambios ya quedaron guardados en el servidor, pero no se pudo actualizar la copia local. Recarga la página antes de continuar.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Los cambios ya quedaron guardados en el servidor, pero no se pudo actualizar la copia local. Recarga la página antes de continuar.',
      repositorio:
        'lanza ConcurrencyError: La sincronización local pendiente cambió o comenzó a procesarse. Recargue el censo antes de reintentar la limpieza.',
      ingreso:
        'lanza ConcurrencyError: La sincronización local pendiente cambió o comenzó a procesarse. Recargue el censo antes de reintentar la limpieza.',
      confirmado: {
        cuadroYAviso: true,
        especialidad:
          'lanza ConcurrencyError: La sincronización local pendiente cambió o comenzó a procesarse. Recargue el censo antes de reintentar la limpieza.',
      },
      historico: 'confirmed',
      rayen:
        'lanza ConcurrencyError: La sincronización local pendiente cambió o comenzó a procesarse. Recargue el censo antes de reintentar la limpieza.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
};
describe('write-result parity: recoveries left out of the first tables', () => {
  beforeEach(async () => {
    await resetParityWorld();
  });
  afterEach(() => {
    stopRefusing();
    stopRefusing = () => {};
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(Object.keys(RECOVERY_CASES))('%s', async name => {
    const observed = await observePatchCase(RECOVERY_CASES[name]);
    if (process.env.PARITY_DUMP) process.stdout.write(`PARITY ${JSON.stringify(observed)}\n`);
    expect(observed).toEqual(RECOVERY_CASES[name].expected);
  });
});
