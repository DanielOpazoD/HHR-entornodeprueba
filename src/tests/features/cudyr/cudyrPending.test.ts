import { describe, expect, it } from 'vitest';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';

describe('resolveCudyrPendingStatus', () => {
  it('shows the score as scheduled before the night shift begins', () => {
    expect(
      resolveCudyrPendingStatus('2026-07-16', new Date('2026-07-16T23:00:00.000Z'))
    ).toMatchObject({
      phase: 'scheduled',
      label: 'Programado · turno noche',
      detail:
        'Aún no corresponde aplicarlo. El CUDYR del 16-07-2026 se completa durante el turno noche y la madrugada del 17-07-2026.',
    }); // 17:00 Rapa Nui
  });

  it('shows the normal application window during the night and following morning', () => {
    expect(
      resolveCudyrPendingStatus('2026-07-16', new Date('2026-07-17T07:00:00.000Z'))
    ).toMatchObject({
      phase: 'application_window',
      label: 'Programado · turno noche',
    }); // 01:00 Rapa Nui
    expect(
      resolveCudyrPendingStatus('2026-07-16', new Date('2026-07-17T17:00:00.000Z'))
    ).toMatchObject({
      phase: 'application_window',
      label: 'Programado · turno noche',
    }); // 11:00 Rapa Nui
  });

  it('requests regularization after the expected window ends', () => {
    expect(
      resolveCudyrPendingStatus('2026-07-16', new Date('2026-07-17T18:00:00.000Z'))
    ).toMatchObject({ phase: 'overdue', label: 'Sin registro' }); // 12:00 Rapa Nui
  });
});
