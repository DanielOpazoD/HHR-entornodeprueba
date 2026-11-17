// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { presentBackupLookupOutcome } from '@/hooks/controllers/backupStorageOutcomeController';

describe('backupStorageOutcomeController', () => {
  it('downgrades permission-like lookup failures to informational copy', () => {
    expect(
      presentBackupLookupOutcome({
        status: 'failed',
        data: {
          exists: false,
          lookup: { exists: false, status: 'error' },
        },
        issues: [
          { kind: 'unknown', message: 'No se pudo confirmar el respaldo por permisos de Storage.' },
        ],
      })
    ).toEqual({
      channel: 'info',
      title: 'Respaldo no verificable',
      message: 'No se pudo confirmar el respaldo remoto por permisos de Storage.',
      state: 'not_verified',
      actionRequired: false,
    });
  });

  it('prefers userSafeMessage for listing failures', () => {
    expect(
      presentBackupLookupOutcome({
        status: 'failed',
        data: {
          exists: false,
          lookup: { exists: false, status: 'error' },
        },
        userSafeMessage: 'La verificación remota no está disponible por ahora.',
        issues: [{ kind: 'unknown', message: 'raw lookup failure' }],
      })
    ).toEqual({
      channel: 'error',
      title: 'Verificación de respaldo fallida',
      message: 'La verificación remota no está disponible por ahora.',
      state: 'blocked',
      actionRequired: true,
    });
  });
});
