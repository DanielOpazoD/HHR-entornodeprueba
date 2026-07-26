import { describe, expect, it } from 'vitest';
import { verifyLocalOccupantsByExactEgreso } from '@/features/rayen-import/domain/historicalLocalEgresoEvidence';

const occupant = {
  bedId: 'NEO1',
  isClinicalCrib: false,
  encounter: {
    encounterId: '142083',
    run: '6.321.880-4',
    firstGivenName: 'Paciente',
    firstFamilyName: 'Ejemplo',
  },
};

describe('historical local egreso evidence', () => {
  it('requires an explicit administrative discharge before verifying the interval', async () => {
    const incomplete = await verifyLocalOccupantsByExactEgreso([occupant], async () => [
      {
        run: '63218804',
        encounterId: '142083',
        egreso: { id: 142083, dateDischarge: '2026-07-25T14:28:00' },
      },
    ]);

    expect(incomplete.verified).toEqual([]);
    expect(incomplete.unresolved).toEqual([occupant]);
  });

  it('accepts an exact episode and RUN with a confirmed administrative discharge', async () => {
    const result = await verifyLocalOccupantsByExactEgreso([occupant], async () => [
      {
        run: '63218804',
        encounterId: '142083',
        egreso: {
          id: 142083,
          dateDischarge: '2026-07-25T14:28:00',
          hasAdministrativeDischarge: true,
        },
      },
    ]);

    expect(result.unresolved).toEqual([]);
    expect(result.verified).toEqual([
      expect.objectContaining({
        bedId: 'NEO1',
        exactEgresoVerified: true,
        dischargeAt: '2026-07-25T14:28:00',
      }),
    ]);
  });
});
