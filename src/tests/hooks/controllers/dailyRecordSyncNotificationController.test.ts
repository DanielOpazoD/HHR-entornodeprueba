// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ConcurrencyError } from '@/services/storage/firestore';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import {
  resolvePatchOutcomeFeedback,
  resolveSaveErrorFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

describe('dailyRecordSyncNotificationController', () => {
  it('reports a server-confirmed save and patch as successful', () => {
    expect(
      resolveSaveOutcomeFeedback(
        createSaveDailyRecordResult({
          date: '2026-03-03',
          outcome: 'clean',
          savedLocally: true,
          savedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
        })
      )
    ).toEqual({
      channel: 'success',
      title: 'Censo guardado',
      message: 'Los cambios quedaron confirmados en el servidor.',
      state: 'ok',
      actionRequired: false,
    });

    expect(
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          date: '2026-03-03',
          outcome: 'clean',
          savedLocally: true,
          updatedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: 1,
        })
      )
    ).toMatchObject({
      channel: 'success',
      title: 'Cambio guardado',
      message: 'La actualización quedó confirmada en el servidor.',
    });
  });

  it('returns feedback for queued and auto-merged save outcomes', () => {
    expect(
      resolveSaveOutcomeFeedback(
        createSaveDailyRecordResult({
          date: '2026-03-03',
          outcome: 'queued',
          savedLocally: true,
          savedRemotely: false,
          queuedForRetry: true,
          autoMerged: false,
        })
      )
    ).toEqual({
      channel: 'warning',
      title: 'Guardado local pendiente',
      kind: 'pending_sync',
      message: 'Los cambios se guardaron localmente y quedarán pendientes de sincronización.',
      state: 'retrying',
      actionRequired: false,
    });

    expect(
      resolveSaveOutcomeFeedback(
        createSaveDailyRecordResult({
          date: '2026-03-03',
          outcome: 'auto_merged',
          savedLocally: true,
          savedRemotely: false,
          queuedForRetry: false,
          autoMerged: true,
        })
      )
    ).toEqual({
      channel: 'warning',
      title: 'Censo actualizado',
      kind: 'auto_merged',
      message: 'El sistema integró los cambios recientes automáticamente.',
      state: 'degraded',
      actionRequired: false,
    });
  });

  it('tells the writer whose field another device changed that the text waits for review', () => {
    const queued = {
      date: '2026-03-03',
      outcome: 'auto_merged',
      savedLocally: true,
      updatedRemotely: false,
      queuedForRetry: true,
      autoMerged: true,
      patchedFields: 1,
    } as const;
    const conflict = resolvePatchOutcomeFeedback(
      createUpdatePartialDailyRecordResult({
        ...queued,
        observabilityTags: ['daily_record', 'write', 'auto_merged', 'field_changed_elsewhere'],
      })
    );

    expect(conflict).toEqual({
      channel: 'warning',
      title: 'Cambio pendiente de revisión',
      kind: 'pending_review',
      message: 'El campo cambió en otro equipo. La edición pendiente se conserva para revisión.',
      state: 'degraded',
      actionRequired: false,
    });
    expect(conflict?.message).not.toMatch(/integró|guardad/i);
    // A real integration keeps its notice.
    expect(resolvePatchOutcomeFeedback(createUpdatePartialDailyRecordResult(queued))?.message).toBe(
      'El sistema integró los cambios recientes automáticamente.'
    );
  });

  it('stays silent for an edit that the day queue task saves, and only for that one', () => {
    const queued = {
      date: '2026-03-03',
      outcome: 'queued',
      savedLocally: true,
      updatedRemotely: false,
      queuedForRetry: true,
      autoMerged: false,
      patchedFields: 2,
    } as const;

    expect(
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          ...queued,
          observabilityTags: ['daily_record', 'write', 'saved_by_queue_route'],
        })
      )
    ).toBeNull();
    // A retry after a failed remote write keeps its notice.
    expect(resolvePatchOutcomeFeedback(createUpdatePartialDailyRecordResult(queued))?.title).toBe(
      'Cambio pendiente de sincronización'
    );
  });

  it('returns feedback for blocked patch outcomes', () => {
    expect(
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          date: '2026-03-03',
          outcome: 'blocked',
          savedLocally: false,
          updatedRemotely: false,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: 1,
          consistencyState: 'unrecoverable',
          userSafeMessage: 'No se encontró un registro local válido para aplicar el cambio.',
        })
      )
    ).toEqual({
      channel: 'error',
      title: 'Actualización bloqueada',
      kind: 'blocked',
      message: 'No se encontró un registro local válido para aplicar el cambio.',
      state: 'blocked',
      actionRequired: true,
    });
  });

  it('surfaces the specific blocked patch reason before falling back to missing-base copy', () => {
    expect(
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          date: '2026-03-03',
          outcome: 'blocked',
          savedLocally: false,
          updatedRemotely: false,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: 1,
          consistencyState: 'blocked_regression',
          blockingReason: 'regression',
          userSafeMessage:
            'Se bloqueó una reducción sospechosa de texto clínico. Recarga antes de reintentar.',
        })
      )
    ).toEqual({
      channel: 'error',
      title: 'Protección de Datos',
      kind: 'blocked',
      message: 'Se bloqueó una reducción sospechosa de texto clínico. Recarga antes de reintentar.',
      state: 'blocked',
      actionRequired: true,
    });
  });

  it('rejects a local-save claim when a blocked operation saved no local copy', () => {
    const feedback = resolvePatchOutcomeFeedback(
      createUpdatePartialDailyRecordResult({
        date: '2026-03-03',
        outcome: 'blocked',
        savedLocally: false,
        updatedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
        userSafeMessage: 'Los cambios se guardaron localmente.',
      })
    );

    expect(feedback).toMatchObject({
      channel: 'error',
      title: 'Actualización bloqueada',
      message: 'La actualización fue rechazada y no quedó confirmada.',
    });
    expect(feedback?.message).not.toMatch(/guardaron localmente/i);
  });

  it('reports a result with no confirmed copy as a complete failure', () => {
    const feedback = resolveSaveOutcomeFeedback(
      createSaveDailyRecordResult({
        date: '2026-03-03',
        outcome: 'unrecoverable',
        savedLocally: false,
        savedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
      })
    );

    expect(feedback).toEqual({
      channel: 'error',
      title: 'Guardado no confirmado',
      kind: 'not_saved',
      message: 'No fue posible confirmar una copia local ni remota de los cambios.',
      state: 'blocked',
      actionRequired: true,
    });
  });

  it('does not describe an invalid queue outcome as locally saved', () => {
    const feedback = resolveSaveOutcomeFeedback(
      createSaveDailyRecordResult({
        date: '2026-03-03',
        outcome: 'queued',
        savedLocally: false,
        savedRemotely: false,
        queuedForRetry: true,
        autoMerged: false,
      })
    );

    expect(feedback).toMatchObject({
      channel: 'error',
      title: 'Guardado no confirmado',
      message: 'No fue posible confirmar una copia local ni remota de los cambios.',
    });
  });

  it('does not claim a retry queue when the result did not enqueue one', () => {
    const feedback = resolvePatchOutcomeFeedback(
      createUpdatePartialDailyRecordResult({
        date: '2026-03-03',
        outcome: 'queued',
        savedLocally: true,
        updatedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
        patchedFields: 1,
      })
    );

    expect(feedback).toMatchObject({
      channel: 'warning',
      title: 'Cambio sólo local',
    });
    expect(feedback?.message).not.toMatch(/reintentar[aá]|pendiente de sincronización/i);
  });

  it('does not claim an automatic merge when the result did not perform one', () => {
    const feedback = resolveSaveOutcomeFeedback(
      createSaveDailyRecordResult({
        date: '2026-03-03',
        outcome: 'auto_merged',
        savedLocally: false,
        savedRemotely: false,
        queuedForRetry: false,
        autoMerged: false,
      })
    );

    expect(feedback).toMatchObject({
      channel: 'error',
      title: 'Guardado no confirmado',
    });
    expect(feedback?.message).not.toMatch(/integró/i);
  });

  it('distinguishes a local-only save from a queued retry', () => {
    expect(
      resolveSaveOutcomeFeedback(
        createSaveDailyRecordResult({
          date: '2026-03-03',
          outcome: 'clean',
          savedLocally: true,
          savedRemotely: false,
          queuedForRetry: false,
          autoMerged: false,
        })
      )
    ).toMatchObject({
      channel: 'warning',
      title: 'Guardado sólo local',
      message: 'Los cambios quedaron guardados en este dispositivo, sin confirmación del servidor.',
    });
  });

  it('prefers userSafeMessage for consistency-related save feedback', () => {
    expect(
      resolveSaveOutcomeFeedback(
        createSaveDailyRecordResult({
          date: '2026-03-03',
          outcome: 'clean',
          savedLocally: true,
          savedRemotely: false,
          queuedForRetry: false,
          autoMerged: false,
          consistencyState: 'unrecoverable',
          userSafeMessage: 'mensaje visible de sync',
        })
      )
    ).toEqual({
      channel: 'warning',
      title: 'Guardado local sin sincronización',
      kind: 'unrecoverable',
      message: 'mensaje visible de sync',
      state: 'degraded',
      actionRequired: false,
    });
  });

  it('does not describe a confirmed server write as unsynchronized', () => {
    expect(
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          date: '2026-03-03',
          outcome: 'clean',
          savedLocally: false,
          updatedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: 1,
          consistencyState: 'unrecoverable',
          userSafeMessage: 'El servidor guardó el cambio; la copia local necesita revisión.',
        })
      )
    ).toMatchObject({
      title: 'Cambio guardado; copia local pendiente',
      message: 'El servidor guardó el cambio; la copia local necesita revisión.',
    });
  });

  it('keeps default census sync feedback free of technical remote wording', () => {
    const defaultFeedback = [
      resolveSaveOutcomeFeedback(
        createSaveDailyRecordResult({
          date: '2026-03-03',
          outcome: 'auto_merged',
          savedLocally: true,
          savedRemotely: false,
          queuedForRetry: false,
          autoMerged: true,
        })
      ),
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          date: '2026-03-03',
          outcome: 'auto_merged',
          savedLocally: true,
          updatedRemotely: false,
          queuedForRetry: false,
          autoMerged: true,
          patchedFields: 1,
        })
      ),
      resolvePatchOutcomeFeedback(
        createUpdatePartialDailyRecordResult({
          date: '2026-03-03',
          outcome: 'clean',
          savedLocally: true,
          updatedRemotely: false,
          queuedForRetry: false,
          autoMerged: false,
          patchedFields: 1,
          consistencyState: 'unrecoverable',
        })
      ),
    ];
    const forbiddenTechnicalWording = /firebase|remot[oa]|stale|cache|concurr/i;

    for (const feedback of defaultFeedback) {
      expect(`${feedback?.title} ${feedback?.message}`).not.toMatch(forbiddenTechnicalWording);
    }
  });
});

// Thrown save errors (formerly src/tests/hooks/dailyRecordSyncNotificationController.test.ts).
describe('resolveSaveErrorFeedback', () => {
  it('maps ConcurrencyError to conflict feedback', () => {
    const error = new ConcurrencyError('conflict');
    const feedback = resolveSaveErrorFeedback(error);

    expect(feedback).toMatchObject({
      title: 'Conflicto de Edición',
      message: 'conflict',
      refetchDelayMs: 2000,
    });
  });

  it('maps DataRegressionError to protection feedback', () => {
    const error = new DataRegressionError('regression', 100, 30);
    const feedback = resolveSaveErrorFeedback(error);

    expect(feedback).toMatchObject({
      title: 'Protección de Datos',
      message: 'regression',
      refetchDelayMs: 3000,
      shouldLog: true,
    });
  });

  it('maps VersionMismatchError to version feedback', () => {
    const error = new VersionMismatchError('mismatch');
    const feedback = resolveSaveErrorFeedback(error);

    expect(feedback).toMatchObject({
      title: 'Versión de Datos Antigua',
      message: 'mismatch',
      refetchDelayMs: 5000,
      shouldLog: true,
    });
  });

  it('maps unknown errors to a non-committal complete-failure message', () => {
    expect(resolveSaveErrorFeedback(new Error('unknown'))).toMatchObject({
      title: 'Guardado no confirmado',
      message:
        'No fue posible completar el guardado. La operación no quedó confirmada; revisa el censo antes de reintentar.',
      shouldLog: true,
    });
  });
});
