import { authoredOptions, captureAuthoringSession } from '@/services/storage/authoringSession';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import * as writeService from '@/services/repositories/dailyRecordRepositoryWriteService';
import { assertDailyRecordRepositoryWriteAccepted } from '@/services/repositories/dailyRecordRepositoryWriteOutcome';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  resolvePatchOutcomeFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { assertDailyRecordWriteAccepted } from '@/hooks/controllers/dailyRecordWriteOutcomeGuard';
import { createDailyRecordAdmitPatientPort } from '@/services/daily-record/dailyRecordAdmitPatientPort';
import { assignSpecialtyManually } from '@/features/census/services/specialtyJevClient';
import {
  isHistoricalPatchOnlyQueued,
  persistHistoricalOccupancyCorrection,
} from '@/features/rayen-import/domain/historicalCorrectionPersistence';
import { assertRayenCensusPersistenceConfirmed } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type {
  PartialUpdateDailyRecordOptions,
  SaveDailyRecordOptions,
} from '@/services/repositories/contracts/dailyRecordCommands';
import { endSessionHook, server } from './dailyRecordWriteResultParityServer.test-support';
import { vi } from 'vitest';

/**
 * Harness of the write-result parity table (W14-D1-1). The shipped repository writes the day on
 * this computer's Dexie (fake-indexeddb) and its real sync queue; only the server's answer is
 * scripted (`dailyRecordWriteResultParityServer.test-support.ts`), so the queue column measures
 * real local durability and no row claims anything about a server copy.
 */
export const PARITY_DATE = '2026-11-17';
export const PARITY_OWNER = 'user:synthetic-parity-A';
export const NEXT_OWNER = 'user:synthetic-parity-B';
export const EDIT = 'NOTA SINTETICA A';
export const BEFORE = 'NOCHE BASE';
export const ELSEWHERE = 'NOCHE CAMBIADA EN OTRO EQUIPO';

const storageFrame = document.createElement('iframe');
document.body.append(storageFrame);
const local = storageFrame.contentWindow!.localStorage;
const session = storageFrame.contentWindow!.sessionStorage;

/** The person's session ends on this computer (logout or 1 h idle) and another person signs in. */
export const endSession = (): void => {
  local.setItem(SESSION_OWNER_KEY, NEXT_OWNER);
  setSessionGeneration('parity-generation-B');
  local.setItem(SESSION_GENERATION_KEY, 'parity-generation-B');
};
endSessionHook.current = endSession;

export const baseDay = (): DailyRecord => {
  const day = DataFactory.createMockDailyRecord(PARITY_DATE, {
    lastUpdated: '2026-11-17T08:00:00.000Z',
    handoffNovedadesNightShift: BEFORE,
  });
  day.beds = {
    R1: DataFactory.createMockPatient('R1', {
      patientName: 'PACIENTE SINTETICO PARIDAD',
      clinicalEpisodeId: 'ep_synthetic_parity_R1',
      pathology: 'DIAGNOSTICO BASE',
    }),
  };
  return day;
};

/** Today's census on this computer and on the server, a signed-in person, an empty queue. */
export const resetParityWorld = async (): Promise<DailyRecord> => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  // The queue worker stays still: each case measures what the write itself left behind.
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  local.clear();
  session.clear();
  setSessionGeneration('parity-generation-A');
  local.setItem(SESSION_OWNER_KEY, PARITY_OWNER);
  local.setItem(SESSION_GENERATION_KEY, 'parity-generation-A');
  server.enabled = true;
  server.answer = { kind: 'accepts' };
  server.writes = 0;
  const day = baseDay();
  server.remoteDay = { ...day };
  await hospitalDB.open();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(day);
  return day;
};

export const NOTE_PATCH: DailyRecordPatch = { handoffNovedadesNightShift: EDIT };

export const patchDay = (
  patch: DailyRecordPatch = NOTE_PATCH,
  options: Omit<PartialUpdateDailyRecordOptions, 'authoringSession'> = {}
) =>
  writeService.updatePartialDetailed(
    PARITY_DATE,
    patch,
    authoredOptions<PartialUpdateDailyRecordOptions>({
      ...options,
      authoringSession: captureAuthoringSession(),
    })
  );

export const saveDay = (
  record: DailyRecord,
  options: Omit<SaveDailyRecordOptions, 'authoringSession'> = {}
) =>
  writeService.saveDetailed(
    record,
    record.lastUpdated,
    authoredOptions<SaveDailyRecordOptions>({
      ...options,
      authoringSession: captureAuthoringSession(),
    })
  );

/** What this computer keeps: its queue tasks by status and owner, and the stored note. */
export const readLocalDurability = async () => {
  const cola: Record<string, number> = {};
  for (const task of await hospitalDB.syncQueue.toArray()) {
    const label = [
      task.status,
      task.ownerKey === PARITY_OWNER ? 'de quien editó' : task.ownerKey,
      task.lastErrorCode,
    ]
      .filter(Boolean)
      .join(' ');
    cola[label] = (cola[label] ?? 0) + 1;
  }
  return {
    cola,
    notaGuardada: (await hospitalDB.dailyRecords.get(PARITY_DATE))?.handoffNovedadesNightShift,
  };
};

export const firestoreError = (code: string, message = `synthetic ${code}`) =>
  Object.assign(new Error(message), { code });

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const outcomeOf = async (step: () => unknown): Promise<string> => {
  try {
    const value = await step();
    return typeof value === 'string' ? value : 'sigue';
  } catch (error) {
    return `lanza ${describeError(error)}`;
  }
};

/**
 * Each consumer's own answer to the same result, one question per column. Values are what a
 * person or the next step observes (text, «sigue», «lanza Clase: mensaje»), never result flags.
 */
export const observeConsumers = async (
  result: DailyRecordWriteResult,
  record: DailyRecord,
  write: 'save' | 'patch'
) => {
  const patch = write === 'patch';
  const feedback = patch ? resolvePatchOutcomeFeedback(result) : resolveSaveOutcomeFeedback(result);
  const repository = buildMockDailyRecordRepository();
  vi.mocked(repository.saveDetailed).mockResolvedValue(result);
  return {
    aviso: feedback ? `${feedback.title}: ${feedback.message}` : 'sin aviso',
    // useDailyRecordSyncQuery.ts:182 / :260: the census flow continues or throws.
    flujo: await outcomeOf(() => assertDailyRecordWriteAccepted(result)),
    // dailyRecordRepositoryWriteOutcome.ts: what `save`/`updatePartial` callers get.
    repositorio: await outcomeOf(() => assertDailyRecordRepositoryWriteAccepted(result)),
    ingreso: patch
      ? await outcomeOf(() =>
          createDailyRecordAdmitPatientPort(async () => result)
            .persistAdmission({
              bedId: 'R1',
              patientName: 'PACIENTE SINTETICO INGRESO',
              rut: '12.345.678-5',
              admissionDate: PARITY_DATE,
              recordDate: PARITY_DATE,
              actor: 'synthetic-parity-A',
            })
            .then(() => 'sigue')
        )
      : 'no aplica',
    confirmado: {
      // The result's state: what the sync box and the notice call «saved».
      cuadroYAviso: result.state === 'confirmed',
      // The timing event (useDailyRecordSyncQuery.ts:263) and the backup restore
      // (dataMaintenanceService.ts:318) are observed through their own flows: see
      // dailyRecordWriteRejectionAsSeen.test.tsx and dailyRecordWriteResultParityMaintenance.test.ts.
      especialidad: patch
        ? await outcomeOf(async () => {
            vi.mocked(writeService.updatePartialDetailed).mockResolvedValueOnce(result);
            await assignSpecialtyManually(
              {
                date: PARITY_DATE,
                bedId: 'R1',
                target: 'bed',
                episodeId: 'ep_synthetic_parity_R1',
              },
              'Medicina',
              null
            );
            return 'confirmada';
          })
        : 'no aplica',
    },
    historico: patch
      ? await outcomeOf(() =>
          isHistoricalPatchOnlyQueued(result) ? 'durably_queued' : 'confirmed'
        )
      : await outcomeOf(async () => {
          await persistHistoricalOccupancyCorrection(repository, record, record);
          return 'confirmada';
        }),
    rayen: await outcomeOf(() => assertRayenCensusPersistenceConfirmed({ record, result })),
  };
};
