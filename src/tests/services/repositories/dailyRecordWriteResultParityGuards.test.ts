import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildMissingBasePartialUpdateResult } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  PARITY_DATE,
  baseDay,
  endSession,
  firestoreError,
  resetParityWorld,
} from './dailyRecordWriteResultParity.test-support';
import { SERVER_CONFIRMED_AT, server } from './dailyRecordWriteResultParityServer.test-support';
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
 * W14-D1-1 — parity table, second part: census edits that the server must accept first, the
 * blocks before anything is written, the manual-specialty exits that throw, and the result the
 * mutation hook builds itself. Same harness and columns as dailyRecordWriteResultParity.test.ts.
 */
const remoteFirst = { requireRemoteAuthorityFirst: true, requireConfirmedRecord: true };
const specialty = () => ({
  ...remoteFirst,
  requireAtomicCas: true,
  specialtyIntent: {
    kind: 'manual' as const,
    date: PARITY_DATE,
    bedId: 'R1',
    target: 'bed' as const,
    episodeId: 'ep_synthetic_parity_R1',
    value: 'Medicina',
    expectedDecisionId: null,
  },
});
const specialtyPatch = { 'beds.R1.specialty': 'Medicina' } as DailyRecordPatch;
const readSpecialty = (record: DailyRecord | null | undefined) => record?.beds?.R1?.specialty;
const clearedBed = () =>
  DataFactory.createMockPatient('R1', {
    patientName: '',
    rut: '',
    pathology: '',
    admissionDate: '',
    clinicalEpisodeId: '',
  });

export const GUARDED_CASES: Record<string, ParityCase> = {
  // W14-D1 H3: reverts and throws, while the direct send (first table) keeps the edit.
  'servidor primero: la sesión ya terminó antes de enviar (H3)': {
    from: 'dailyRecordRemotePersistenceController.ts:286-310',
    options: remoteFirst,
    beforeWrite: endSession,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      aviso: 'sin aviso',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: La sesión cambió. La operación no fue enviada ni guardada.',
      repositorio: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      ingreso: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      confirmado: {
        cuadroYAviso: false,
        especialidad: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      },
      historico: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      rayen: 'lanza Error: La sesión cambió antes de enviar la escritura.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'servidor primero: confirma y devuelve su versión': {
    from: 'dailyRecordRemotePersistenceController.ts:351-379',
    options: remoteFirst,
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
  // Disagree: box, notice and Rayen's history say confirmed; the flow throws and the view reverts.
  'servidor primero: confirma pero su versión no se puede leer': {
    from: 'dailyRecordRemotePersistenceController.ts:353-366 (remoteCommitted)',
    options: remoteFirst,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'saved',
      aviso:
        'Cambio guardado; copia local pendiente: Los cambios ya quedaron guardados en el servidor, pero no se pudo actualizar la copia local. Recarga la página antes de continuar.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Los cambios ya quedaron guardados en el servidor, pero no se pudo actualizar la copia local. Recarga la página antes de continuar.',
      repositorio:
        'lanza Error: La autoridad remota no devolvió la versión confirmada del registro.',
      ingreso: 'lanza Error: La autoridad remota no devolvió la versión confirmada del registro.',
      confirmado: {
        cuadroYAviso: true,
        especialidad:
          'lanza Error: La autoridad remota no devolvió la versión confirmada del registro.',
      },
      historico: 'confirmed',
      rayen: 'lanza Error: La autoridad remota no devolvió la versión confirmada del registro.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'servidor primero: el servidor rechaza': {
    from: 'dailyRecordRemotePersistenceController.ts:336-349 (lanza)',
    options: remoteFirst,
    answer: { kind: 'refuses', error: () => firestoreError('permission-denied') },
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      lanza: 'Error: synthetic permission-denied',
      aviso:
        'Cambio no guardado: No fue posible completar la actualización. El cambio no quedó confirmado; revisa el censo antes de reintentar.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  // Called directly: with a census on screen the hook always passes its base, so the repository
  // meets a missing day only through other callers (admission port, Rayen, specialty).
  'no hay registro del día para aplicar el cambio': {
    from: 'dailyRecordPartialUpdateBlockingController.ts:5-6 (dailyRecordRepositoryWriteService.ts:282)',
    respond: () => buildMissingBasePartialUpdateResult(PARITY_DATE),
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      aviso:
        'Actualización bloqueada: No se encontró un registro local válido para aplicar el cambio.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: No se encontró un registro local válido para aplicar el cambio.',
      repositorio: 'lanza Error: No se encontró un registro local válido para aplicar el cambio.',
      ingreso: 'lanza Error: No se encontró un registro local válido para aplicar el cambio.',
      confirmado: {
        cuadroYAviso: false,
        especialidad:
          'lanza Error: No se encontró un registro local válido para aplicar el cambio.',
      },
      historico: 'lanza Error: No se encontró un registro local válido para aplicar el cambio.',
      rayen: 'lanza Error: No se encontró un registro local válido para aplicar el cambio.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'la fecha de ingreso queda fuera de la ventana permitida': {
    from: 'dailyRecordPartialUpdateBlockingController.ts:53-80 (dailyRecordRepositoryWriteService.ts:345)',
    patch: {
      'beds.R1': DataFactory.createMockPatient('R1', {
        patientName: 'PACIENTE SINTETICO NUEVO',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'ep_synthetic_parity_new',
        firstSeenDate: PARITY_DATE,
        admissionDate: '2026-10-01',
      }),
    } as DailyRecordPatch,
    read: record => record?.beds?.R1?.patientName,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      aviso:
        'Actualización bloqueada: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      repositorio:
        'lanza AdmissionDatePolicyViolationError: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      ingreso:
        'lanza AdmissionDatePolicyViolationError: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      confirmado: {
        cuadroYAviso: false,
        especialidad:
          'lanza AdmissionDatePolicyViolationError: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      },
      historico:
        'lanza AdmissionDatePolicyViolationError: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      rayen:
        'lanza AdmissionDatePolicyViolationError: La fecha no coincide con la primera aparición observada. Revisa 2026-11-16 / 2026-11-17 / 2026-11-18. (PACIENTE SINTETICO NUEVO · 11.111.111-1)',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'un diagnóstico largo se acorta de golpe': {
    from: 'dailyRecordPartialUpdateBlockingController.ts:82-115 (dailyRecordRepositoryWriteService.ts:402)',
    // The guard blocks only when the server also advanced since this computer's copy.
    arrange: async () => {
      const day = (await hospitalDB.dailyRecords.get(PARITY_DATE))!;
      day.beds.R1.pathology = 'DIAGNOSTICO SINTETICO LARGO DE PRUEBA';
      await hospitalDB.dailyRecords.put(day);
      server.remoteDay = { ...day, lastUpdated: '2026-11-17T09:00:00.000Z' };
    },
    patch: { 'beds.R1.pathology': 'DX' } as DailyRecordPatch,
    read: record => record?.beds?.R1?.pathology,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      aviso:
        'Protección de Datos: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      flujo:
        'lanza DailyRecordWriteBlockedOutcomeError: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      repositorio:
        'lanza DataRegressionError: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      ingreso:
        'lanza DataRegressionError: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      confirmado: {
        cuadroYAviso: false,
        especialidad:
          'lanza DataRegressionError: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      },
      historico:
        'lanza DataRegressionError: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      rayen:
        'lanza DataRegressionError: Se bloqueó una reducción sospechosa de texto clínico (37 -> 2 caracteres). Recarga antes de reintentar para evitar pérdida de información.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'especialidad elegida a mano sin servidor disponible': {
    from: 'dailyRecordRepositoryWriteService.ts:318-320 (lanza)',
    arrange: () => (server.enabled = false),
    patch: specialtyPatch,
    options: specialty(),
    read: readSpecialty,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      lanza: 'Error: La autoridad remota no está disponible para esta escritura clínica.',
      aviso:
        'Cambio no guardado: No fue posible completar la actualización. El cambio no quedó confirmado; revisa el censo antes de reintentar.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'especialidad elegida a mano: no se pudo leer la versión del servidor': {
    from: 'dailyRecordRepositoryWriteService.ts:322-326 (lanza)',
    arrange: () => (server.remoteDay = null),
    patch: specialtyPatch,
    options: specialty(),
    read: readSpecialty,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      lanza: 'Error: No se pudo verificar la versión remota del censo. Vuelve a intentarlo.',
      aviso:
        'Cambio no guardado: No fue posible completar la actualización. El cambio no quedó confirmado; revisa el censo antes de reintentar.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'especialidad elegida a mano: el paciente cambió en el servidor': {
    from: 'dailyRecordRepositoryWriteService.ts:329-334 (lanza)',
    arrange: () => {
      const remote = baseDay();
      remote.beds.R1.clinicalEpisodeId = 'ep_synthetic_parity_other';
      server.remoteDay = { ...remote, lastUpdated: '2026-11-17T09:00:00.000Z' };
    },
    patch: specialtyPatch,
    options: specialty(),
    read: readSpecialty,
    expected: {
      vista: 'vuelve al valor anterior',
      cuadro: 'error',
      lanza:
        'ConcurrencyError: El paciente o su especialidad cambió. Revisa el censo antes de volver a elegir.',
      aviso:
        'Conflicto de Edición: El paciente o su especialidad cambió. Revisa el censo antes de volver a elegir.',
      cola: {},
      notaGuardada: 'NOCHE BASE',
    },
  },
  'limpiar una cama que el servidor ya tenía limpia': {
    from: 'usePatchDailyRecordMutation.ts:157-172 (el hook arma el resultado)',
    patch: { 'beds.R1': clearedBed() } as DailyRecordPatch,
    options: {
      ...remoteFirst,
      intentionalBedClear: {
        bedId: 'R1',
        confirmedLastUpdated: baseDay().lastUpdated,
        confirmedOccupant: { clinicalEpisodeId: 'ep_synthetic_parity_R1' },
      },
    },
    authoritative: () => ({
      ...baseDay(),
      lastUpdated: SERVER_CONFIRMED_AT,
      beds: { R1: clearedBed() },
    }),
    read: record => record?.beds?.R1?.patientName,
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
      notaGuardada: 'NOCHE BASE',
    },
  },
};

describe('write-result parity: server-first edits, blocks and the hook result', () => {
  beforeEach(async () => {
    await resetParityWorld();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(Object.keys(GUARDED_CASES))('%s', async name => {
    const observed = await observePatchCase(GUARDED_CASES[name]);
    if (process.env.PARITY_DUMP) process.stdout.write(`PARITY ${JSON.stringify(observed)}\n`);
    expect(observed).toEqual(GUARDED_CASES[name].expected);
  });
});
