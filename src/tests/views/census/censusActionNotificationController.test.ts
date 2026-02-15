import { describe, expect, it } from 'vitest';
import {
  buildDischargeErrorNotification,
  buildMoveOrCopyErrorNotification,
  buildMoveOrCopyUnexpectedNotification,
  buildRowActionBlockedNotification,
  buildRowActionUnexpectedNotification,
  buildTransferErrorNotification,
} from '@/features/census/controllers/censusActionNotificationController';

describe('censusActionNotificationController', () => {
  it('builds row-action blocked notification', () => {
    expect(buildRowActionBlockedNotification('No permitido')).toEqual({
      title: 'Acción bloqueada',
      message: 'No permitido',
    });
    expect(buildRowActionUnexpectedNotification()).toEqual({
      title: 'No se pudo ejecutar la acción',
      message: 'Ocurrió un error inesperado al procesar la acción del paciente.',
    });
  });

  it('builds move/copy notifications with contextual title', () => {
    expect(buildMoveOrCopyErrorNotification('COPY_TO_DATE_FAILED', 'error')).toEqual({
      title: 'No se pudo copiar',
      message: 'error',
    });
    expect(buildMoveOrCopyErrorNotification('RECORD_NOT_AVAILABLE', 'error')).toEqual({
      title: 'No se pudo mover/copiar',
      message: 'error',
    });
  });

  it('builds fallback unexpected move/copy notification', () => {
    expect(buildMoveOrCopyUnexpectedNotification()).toEqual({
      title: 'No se pudo mover/copiar',
      message: 'Ocurrió un error inesperado al ejecutar la acción.',
    });
  });

  it('builds discharge and transfer notifications with contextual titles', () => {
    expect(buildDischargeErrorNotification('INVALID_TIME_FORMAT', 'error').title).toBe(
      'Datos de alta incompletos'
    );
    expect(buildTransferErrorNotification('ACTIONS_LOCKED', 'error').title).toBe(
      'Traslado bloqueado'
    );
  });
});
