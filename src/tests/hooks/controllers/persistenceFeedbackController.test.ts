// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCopyPatientNotifications,
  buildCreateDayNotifications,
  resolveCreateDayFailureNotice,
} from '@/hooks/controllers/persistenceFeedbackController';

describe('persistenceFeedbackController', () => {
  it('returns only success notification for clean day creation', () => {
    expect(
      buildCreateDayNotifications({
        sourceDate: '2026-03-03',
        outcome: 'clean',
        hasCriticalLegacyRepair: false,
      })
    ).toEqual([
      {
        channel: 'success',
        title: 'Día creado',
        message: 'Copiado desde 2026-03-03',
      },
    ]);
  });

  it('adds warning only for critical repaired day creation', () => {
    expect(
      buildCreateDayNotifications({
        sourceDate: '2026-03-03',
        outcome: 'repaired',
        hasCriticalLegacyRepair: true,
      })
    ).toHaveLength(2);
  });

  it('warns only for critically repaired patient copies', () => {
    expect(
      buildCopyPatientNotifications({
        outcome: 'clean',
        hasCriticalLegacyRepair: true,
      })
    ).toEqual([]);

    expect(
      buildCopyPatientNotifications({
        outcome: 'repaired',
        hasCriticalLegacyRepair: true,
      })
    ).toEqual([
      {
        channel: 'warning',
        title: 'Se corrigieron datos heredados',
        message:
          'La copia se realizó correctamente, pero se repararon datos antiguos del paciente.',
      },
    ]);
  });

  it('resolves create-day failure notice from the first issue', () => {
    expect(resolveCreateDayFailureNotice([{ message: 'fallo visible' }])).toEqual({
      channel: 'warning',
      title: 'No se pudo crear el día',
      message: 'fallo visible',
    });
  });
});
