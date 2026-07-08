import { describe, expect, it } from 'vitest';
import {
  resolvePatchOutcomeFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';

describe('dailyRecordSyncNotificationController', () => {
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
      message: 'El sistema integró los cambios recientes automáticamente.',
      state: 'degraded',
      actionRequired: false,
    });
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
      message: 'Se bloqueó una reducción sospechosa de texto clínico. Recarga antes de reintentar.',
      state: 'blocked',
      actionRequired: true,
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
      message: 'mensaje visible de sync',
      state: 'degraded',
      actionRequired: false,
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
