import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  ConcurrencyError,
  createFieldChangedElsewhereError,
  createSavedByQueueRouteError,
} from '@/services/storage/syncErrorCatalog';
import {
  ELSEWHERE,
  PARITY_OWNER,
  endSession,
  firestoreError,
  resetParityWorld,
} from './dailyRecordWriteResultParity.test-support';
import { server, type ServerAnswer } from './dailyRecordWriteResultParityServer.test-support';
import { observePatchCase, type ParityCase } from './dailyRecordWriteResultParityView.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

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
 * W14-D1-1 — parity table of the write result of one census edit sent directly
 * (`updatePartialDetailed` → `persistLocalAndAttemptRemoteSync` and its recovery). Each row
 * produces a shape that exists today with the shipped repository, Dexie queue and recovery
 * controllers, mounted under the census mutation hook; the server's answer is the only scripted
 * input. A row pins every consumer's answer to that same shape. Where consumers disagree, a
 * one-line comment says so: that is today's behaviour, pinned so later PRs can prove they keep
 * it (or change it on purpose), not fixed here.
 */
/*
 * Columns (each consumer's own answer; values are what a person or the next step observes):
 * vista: what the census shows after the mutation (usePatchDailyRecordMutation onSuccess/onError);
 * cuadro: the sync box (dailyRecordSyncStatusController); aviso: the notice
 * (dailyRecordSyncNotificationController, or the error notice when the mutation rejects);
 * flujo: the census flow (assertDailyRecordWriteAccepted); repositorio: `updatePartial` callers
 * (dailyRecordRepositoryWriteOutcome); ingreso: the admission port; confirmado: each current
 * definition of «server-confirmed» that takes a result (box/notice, specialty; the timing event
 * and the backup restore are observed in their own flows: dailyRecordWriteRejectionAsSeen.test.tsx
 * and dailyRecordWriteResultParityMaintenance.test.ts); historico: Rayen's historical class;
 * rayen: the structural guard; cola / notaGuardada: what this computer keeps (Dexie).
 */
const refuses = (error: () => unknown): ServerAnswer => ({ kind: 'refuses', error });
/** A clinical event: the census shows it only when the mutation publishes the write's record. */
const EVENT_PATCH = {
  'beds.R1.clinicalEvents': [
    {
      id: 'evento-sintetico-paridad',
      name: 'PROCEDIMIENTO SINTETICO',
      date: '2026-11-17',
      createdAt: '2026-11-17T09:00:00.000Z',
    },
  ],
} as unknown as DailyRecordPatch;
const shownEvents = (record: DailyRecord | null | undefined) =>
  JSON.stringify(record?.beds?.R1?.clinicalEvents ?? []);
const versionConflict = () =>
  new ConcurrencyError('synthetic version conflict', 'version_mismatch');

export const DIRECT_SEND_CASES: Record<string, ParityCase> = {
  'el servidor confirma sin devolver su versión': {
    from: 'dailyRecordRemotePersistenceController.ts:425,465',
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
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'el servidor confirma y devuelve su versión': {
    from: 'dailyRecordRemotePersistenceController.ts:451-463',
    answer: { kind: 'accepts_with_receipt' },
    expected: {
      vista: 'muestra la versión del servidor',
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
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  // Disagree: «confirmed» for Rayen's history, not for the box, the timing or specialty.
  'solo en este equipo: no hay servidor configurado': {
    from: 'dailyRecordRemotePersistenceController.ts:405',
    arrange: () => (server.enabled = false),
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso:
        'Cambio sólo local: La actualización quedó guardada en este dispositivo, sin confirmación del servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen: 'sigue',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'sin red: queda en la cola y se reintenta solo': {
    from: 'dailyRecordRemoteWriteController.ts (resolveRemoteWriteRecovery: retryable)',
    answer: refuses(() => firestoreError('unavailable')),
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso:
        'Cambio pendiente de sincronización: La actualización quedó guardada localmente y se reintentará la sincronización.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen:
        'lanza Error: Los cambios se guardaron localmente y quedaron pendientes de sincronización.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  // W14-D1 H1: contradice SAVE-01 (ver REPORT): the local copy the notice reports exists, yet
  // the flow rejects and the view reverts while that durable copy keeps the edit.
  'el servidor rechaza sin reintento después de encolar (H1)': {
    from: 'dailyRecordRemoteWriteController.ts (resolveRemoteWriteRecovery: no safe route)',
    answer: refuses(() => firestoreError('permission-denied')),
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'local',
      aviso:
        'Cambio local sin sincronización: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      repositorio: 'sigue',
      ingreso:
        'lanza Error: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'durably_queued',
      rayen:
        'lanza Error: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'un alta o traslado desde la cama: lo guarda la tarea del día': {
    from: 'dailyRecordRemoteWriteController.ts:136-149',
    answer: refuses(() => createSavedByQueueRouteError('synthetic route')),
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso: 'sin aviso',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen:
        'lanza Error: Los cambios se guardaron localmente y quedaron pendientes de sincronización.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'otro equipo cambió otro campo: se fusiona solo': {
    from: 'dailyRecordWriteConcurrencyRecoveryController.ts:60-68',
    answer: refuses(versionConflict),
    arrange: () =>
      (server.remoteDay = {
        ...server.remoteDay!,
        lastUpdated: '2026-11-17T09:00:00.000Z',
        handoffNovedadesDayShift: 'DIA CAMBIADO EN OTRO EQUIPO',
      }),
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso: 'Cambio actualizado: El sistema integró los cambios recientes automáticamente.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen: 'lanza ConcurrencyError: Se resolvió un conflicto remoto mediante fusión automática.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'otro equipo cambió el mismo campo: queda retenido para revisión': {
    from: 'dailyRecordWriteConcurrencyRecoveryController.ts:51-58',
    answer: refuses(createFieldChangedElsewhereError),
    arrange: () =>
      (server.remoteDay = {
        ...server.remoteDay!,
        lastUpdated: '2026-11-17T09:00:00.000Z',
        handoffNovedadesNightShift: ELSEWHERE,
      }),
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso:
        'Cambio pendiente de revisión: El campo cambió en otro equipo. La edición pendiente se conserva para revisión.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen:
        'lanza ConcurrencyError: El campo cambió en otro equipo. La edición pendiente se conserva para revisión.',
      cola: {
        'CONFLICT de quien editó daily_record_field_changed_elsewhere': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  // Same disagreement as H1: notice says «local», view reverts, the queue keeps the edit.
  'conflicto que no se puede fusionar (el servidor no tiene el día)': {
    from: 'dailyRecordWriteConcurrencyRecoveryController.ts:71-79',
    answer: refuses(versionConflict),
    arrange: () => (server.remoteDay = null),
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'local',
      aviso:
        'Cambio local sin sincronización: Se detectó un conflicto remoto que requiere revisión manual.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Se detectó un conflicto remoto que requiere revisión manual.',
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
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'la cola está llena y no acepta el cambio': {
    from: 'dailyRecordRemotePersistenceController.ts:382-393 (syncQueueEngine.ts:186-197)',
    arrange: () =>
      hospitalDB.syncQueue.bulkAdd(
        Array.from({ length: 192 }, (_, index) => ({
          opId: `synthetic-backlog-${index}`,
          type: 'UPDATE_DAILY_RECORD' as const,
          key: `daily:2026-10-01#${index}`,
          payload: { date: '2026-10-01' },
          timestamp: index,
          retryCount: 0,
          status: 'PENDING' as const,
          ownerKey: PARITY_OWNER,
        }))
      ),
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      aviso: 'Cambio no guardado: No fue posible confirmar una copia local ni remota del cambio.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: La cola de sincronización alcanzó su límite operativo. Revisa conectividad o libera tareas pendientes antes de reintentar.',
      repositorio:
        'lanza Error: La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.',
      ingreso:
        'lanza Error: La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.',
      confirmado: {
        cuadroYAviso: false,
        especialidad:
          'lanza Error: La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.',
      },
      historico:
        'lanza Error: La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.',
      rayen:
        'lanza Error: La cola de sincronización alcanzó su límite operativo antes de confirmar la persistencia local.',
      cola: {
        'PENDING de quien editó': 192,
      },
      notaGuardada: 'NOCHE BASE',
    },
  },
  // Disagree: the result says «not accepted» while the queue keeps a task for its author.
  // The view is left as it was: an edit whose session ended no longer writes the census cache
  // (W14-H3). This harness changes the session without what clears that cache in the app:
  // the logout, or the admission of a different account (useAuthState).
  // dailyRecordWriteRejectionAsSeen.test.tsx measures what the next session sees.
  'la sesión terminó antes de guardar: la cola lo guarda solo para su autor': {
    from: 'dailyRecordRemotePersistenceController.ts:382-393 (retained_for_owner)',
    beforeWrite: endSession,
    expected: {
      vista: 'conserva la edición',
      cuadro: 'error',
      aviso: 'sin aviso',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: La sesión cambió antes de guardar. El cambio quedó pendiente para la persona que lo hizo.',
      repositorio:
        'lanza Error: La sesión cambió antes de guardar; el cambio quedó para su usuario original.',
      ingreso:
        'lanza Error: La sesión cambió antes de guardar; el cambio quedó para su usuario original.',
      confirmado: {
        cuadroYAviso: false,
        especialidad:
          'lanza Error: La sesión cambió antes de guardar; el cambio quedó para su usuario original.',
      },
      historico:
        'lanza Error: La sesión cambió antes de guardar; el cambio quedó para su usuario original.',
      rayen:
        'lanza Error: La sesión cambió antes de guardar; el cambio quedó para su usuario original.',
      cola: {
        'FAILED de quien editó session_owner_logged_out': 1,
      },
      notaGuardada: 'NOCHE BASE',
    },
  },
  // W14-D1 H3: the direct send keeps the edit; server-first reverts (Guards table).
  'la sesión termina durante el envío directo (H3)': {
    from: 'dailyRecordRemotePersistenceController.ts:467-482',
    answer: { kind: 'refuses_after_session_ends', error: () => firestoreError('unavailable') },
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso: 'sin aviso',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen:
        'lanza Error: El censo quedó guardado localmente y está pendiente de confirmación en la nube. La información clínica no se aplicó; vuelve a sincronizar cuando termine el guardado.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  // Disagree: the box says «saved», yet the census shows the event only after its next read:
  // a server answer without its version leaves the mutation no record to publish.
  'un evento clínico confirmado por el servidor': {
    from: 'usePatchDailyRecordMutation.ts onSuccess (confirmado)',
    patch: EVENT_PATCH,
    read: shownEvents,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'saved',
      aviso: 'Cambio guardado: La actualización quedó confirmada en el servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: { cuadroYAviso: true, especialidad: 'confirmada' },
      historico: 'confirmed',
      rayen: 'sigue',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  // The queued event becomes the base of this tab's next edit, so the census shows it.
  'un evento clínico sin red: queda en la cola': {
    from: 'usePatchDailyRecordMutation.ts onSuccess (evento clínico encolado)',
    patch: EVENT_PATCH,
    read: shownEvents,
    answer: refuses(() => firestoreError('unavailable')),
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso:
        'Cambio pendiente de sincronización: La actualización quedó guardada localmente y se reintentará la sincronización.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen:
        'lanza Error: Los cambios se guardaron localmente y quedaron pendientes de sincronización.',
      cola: { 'PENDING de quien editó': 1 },
      notaGuardada: 'NOCHE BASE',
    },
  },
  // Disagree: kept on this computer and in its queue, yet the census shows it only after a read.
  'un evento clínico sin servidor configurado: solo en este equipo': {
    from: 'usePatchDailyRecordMutation.ts onSuccess (solo local)',
    patch: EVENT_PATCH,
    read: shownEvents,
    arrange: () => (server.enabled = false),
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'local',
      aviso:
        'Cambio sólo local: La actualización quedó guardada en este dispositivo, sin confirmación del servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'sigue',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: No se confirmó la especialidad en el censo remoto.',
      },
      historico: 'confirmed',
      rayen: 'sigue',
      cola: { 'PENDING de quien editó': 1 },
      notaGuardada: 'NOCHE BASE',
    },
  },
};

describe('write-result parity: a census edit sent directly', () => {
  beforeEach(async () => {
    await resetParityWorld();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(Object.keys(DIRECT_SEND_CASES))('%s', async name => {
    const observed = await observePatchCase(DIRECT_SEND_CASES[name]);
    if (process.env.PARITY_DUMP) process.stdout.write(`PARITY ${JSON.stringify(observed)}\n`);
    expect(observed).toEqual(DIRECT_SEND_CASES[name].expected);
  });
});
