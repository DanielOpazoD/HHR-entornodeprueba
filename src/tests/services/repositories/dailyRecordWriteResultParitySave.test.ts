import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  EDIT,
  baseDay,
  endSession,
  firestoreError,
  observeConsumers,
  readLocalDurability,
  resetParityWorld,
  saveDay,
} from './dailyRecordWriteResultParity.test-support';
import { server, type ServerAnswer } from './dailyRecordWriteResultParityServer.test-support';
import { describeThrown, runSaveInHook } from './dailyRecordWriteResultParityView.test-support';
import { resolveSaveErrorFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';

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
 * W14-D1-1 — parity table, whole-day saves (`saveDetailed`, `buildSaveResult` and
 * `buildBlockedSaveResult`) through the mounted useSaveDailyRecordMutation, plus the backup
 * import's deferred save. Same harness and columns as dailyRecordWriteResultParity.test.ts.
 */
interface SaveCase {
  from: string;
  answer?: ServerAnswer;
  arrange?: () => unknown;
  beforeWrite?: () => unknown;
  extra?: { rayenStructuralWriteGuard?: boolean; requireConfirmedRecord?: boolean };
  record?: () => DailyRecord;
  /** The backup import calls the repository itself, without the census mutation. */
  backup?: boolean;
  expected: Record<string, unknown>;
}

const edited = (): DailyRecord => ({ ...baseDay(), handoffNovedadesNightShift: EDIT });
const rayen = { rayenStructuralWriteGuard: true, requireConfirmedRecord: true };

export const SAVE_CASES: Record<string, SaveCase> = {
  'el servidor confirma el día completo': {
    from: 'dailyRecordRepositoryWriteService.ts:280 (dailyRecordRemotePersistenceController.ts:465)',
    expected: {
      vista: 'conserva la edición',
      cuadro: 'saved',
      aviso: 'Censo guardado: Los cambios quedaron confirmados en el servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: true,
        especialidad: 'no aplica',
      },
      historico: 'lanza Error: No se confirmó la conciliación del censo histórico.',
      rayen: 'sigue',
      cola: {},
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'el servidor confirma el día completo y devuelve su versión': {
    from: 'dailyRecordRemotePersistenceController.ts:451-463 (completeConfirmedLocalWrite)',
    answer: { kind: 'accepts_with_receipt' },
    expected: {
      vista: 'muestra la versión del servidor',
      cuadro: 'saved',
      aviso: 'Censo guardado: Los cambios quedaron confirmados en el servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: true,
        especialidad: 'no aplica',
      },
      historico: 'confirmada',
      rayen: 'sigue',
      cola: {},
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'sin red: el día completo queda en la cola': {
    from: 'dailyRecordRemoteRecoveryController.ts:22',
    answer: { kind: 'refuses', error: () => firestoreError('unavailable') },
    expected: {
      vista: 'conserva la edición',
      cuadro: 'local',
      aviso:
        'Guardado local pendiente: Los cambios se guardaron localmente y quedarán pendientes de sincronización.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'no aplica',
      },
      historico:
        'lanza Error: Los cambios se guardaron localmente y quedaron pendientes de sincronización.',
      rayen:
        'lanza Error: Los cambios se guardaron localmente y quedaron pendientes de sincronización.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  // Same disagreement as the edit's H1: the notice says «local» while the view reverts.
  'el servidor rechaza el día completo sin reintento': {
    from: 'dailyRecordRemoteRecoveryController.ts:29-35',
    answer: { kind: 'refuses', error: () => firestoreError('permission-denied') },
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'local',
      aviso:
        'Guardado local sin sincronización: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'no aplica',
      },
      historico:
        'lanza Error: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      rayen:
        'lanza Error: Los cambios se guardaron localmente, pero la sincronización remota requiere revisión manual.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'el servidor usa un formato más nuevo que esta versión': {
    from: 'dailyRecordWriteState.ts:138-156,187-229 (dailyRecordRepositoryWriteService.ts:186)',
    arrange: () => (server.remoteDay = { ...server.remoteDay!, schemaVersion: 999 }),
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      aviso:
        'Versión de Datos Antigua: Tu aplicación está desactualizada (v1) y el registro en la nube usa el nuevo formato v999.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Tu aplicación está desactualizada (v1) y el registro en la nube usa el nuevo formato v999.',
      repositorio:
        'lanza VersionMismatchError: Tu aplicación está desactualizada (v1) y el registro en la nube usa el nuevo formato v999.',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'no aplica',
      },
      historico:
        'lanza VersionMismatchError: Tu aplicación está desactualizada (v1) y el registro en la nube usa el nuevo formato v999.',
      rayen:
        'lanza VersionMismatchError: Tu aplicación está desactualizada (v1) y el registro en la nube usa el nuevo formato v999.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  // Disagree: the box says error while the notice says «integrated» and the flow continues.
  'el día completo vaciaría una cama que el servidor tiene ocupada': {
    from: 'dailyRecordRepositoryWriteService.ts:162-176 (fusión automática del bloqueo)',
    record: () => {
      const day = edited();
      day.beds.R1 = { ...day.beds.R1, patientName: '', rut: '', clinicalEpisodeId: '' };
      return day;
    },
    expected: {
      vista: 'conserva la edición',
      cuadro: 'error',
      aviso: 'Censo actualizado: El sistema integró los cambios recientes automáticamente.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'no aplica',
      },
      historico:
        'lanza Error: Se detectó una posible pérdida de datos y se fusionó automáticamente con la copia remota.',
      rayen:
        'lanza Error: Se detectó una posible pérdida de datos y se fusionó automáticamente con la copia remota.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  'importación estructural de Rayen confirmada por el servidor': {
    from: 'dailyRecordRemotePersistenceController.ts:351-379',
    extra: rayen,
    answer: { kind: 'accepts_with_receipt' },
    expected: {
      vista: 'muestra la versión del servidor',
      cuadro: 'saved',
      aviso: 'Censo guardado: Los cambios quedaron confirmados en el servidor.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: true,
        especialidad: 'no aplica',
      },
      historico: 'confirmada',
      rayen: 'sigue',
      cola: {},
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
  // W14-D1 H3 (whole day): the flow throws but the departing session's view keeps the edit.
  'importación estructural de Rayen: la sesión terminó antes de enviar': {
    from: 'dailyRecordRemotePersistenceController.ts:286-310',
    extra: rayen,
    beforeWrite: endSession,
    expected: {
      vista: 'conserva la edición',
      cuadro: 'error',
      aviso: 'sin aviso',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: La sesión cambió. La operación no fue enviada ni guardada.',
      repositorio: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'no aplica',
      },
      historico: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      rayen: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'respaldo importado: queda en la cola sin enviar': {
    from: 'dailyRecordRepositoryWriteService.ts:195-214 (deferRemoteSync)',
    backup: true,
    expected: {
      vista: 'no aplica: no pasa por el censo en pantalla',
      cuadro: 'no aplica',
      aviso:
        'Guardado local pendiente: Los cambios se guardaron localmente y quedarán pendientes de sincronización.',
      flujo: 'sigue',
      repositorio: 'sigue',
      ingreso: 'no aplica',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'no aplica',
      },
      historico:
        'lanza Error: El censo quedó guardado localmente y está pendiente de confirmación en la nube. La información clínica no se aplicó; vuelve a sincronizar cuando termine el guardado.',
      rayen:
        'lanza Error: El censo quedó guardado localmente y está pendiente de confirmación en la nube. La información clínica no se aplicó; vuelve a sincronizar cuando termine el guardado.',
      cola: {
        'PENDING de quien editó': 1,
      },
      notaGuardada: 'NOTA SINTETICA A',
    },
  },
};

const observeSave = async (testCase: SaveCase) => {
  if (testCase.answer) server.answer = testCase.answer;
  await testCase.arrange?.();
  const record = testCase.record?.() ?? edited();
  const run = testCase.backup
    ? {
        result: await saveDay(record, { writeOrigin: 'backup_restore', deferRemoteSync: true }),
        error: undefined,
        vista: 'no aplica: no pasa por el censo en pantalla',
        cuadro: 'no aplica',
      }
    : await runSaveInHook(record, testCase.extra, testCase.beforeWrite);
  const durability = await readLocalDurability();
  if (!run.result) {
    const feedback = resolveSaveErrorFeedback(run.error);
    return {
      vista: run.vista,
      cuadro: run.cuadro,
      lanza: describeThrown(run.error),
      aviso: `${feedback.title}: ${feedback.message}`,
      ...durability,
    };
  }
  return {
    vista: run.vista,
    cuadro: run.cuadro,
    ...(await observeConsumers(run.result, record)),
    ...durability,
  };
};

describe('write-result parity: a whole-day save', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
    await resetParityWorld();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(Object.keys(SAVE_CASES))('%s', async name => {
    const observed = await observeSave(SAVE_CASES[name]);
    if (process.env.PARITY_DUMP) process.stdout.write(`PARITY ${JSON.stringify(observed)}\n`);
    expect(observed).toEqual(SAVE_CASES[name].expected);
  });
});
