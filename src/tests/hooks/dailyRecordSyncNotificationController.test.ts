import { describe, expect, it } from 'vitest';

import { ConcurrencyError } from '@/services/storage/firestoreService';
import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import { resolveSaveErrorFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';

describe('dailyRecordSyncNotificationController', () => {
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

  it('returns null for unknown errors', () => {
    expect(resolveSaveErrorFeedback(new Error('unknown'))).toBeNull();
  });
});
