import { describe, expect, it, vi } from 'vitest';
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
  const officialText = `1.RUN: 6321880 - 4
24 INGRESO 1 6 - 4 1 2 4 - 0 7 - 2 6 Cuidados Medios
29 EGRESO 1 4 - 2 8 2 5 - 0 7 - 2 6`;
  const sparseLookup = async () => [
    {
      run: '63218804',
      encounterId: '142083',
      egreso: { id: 142083, endPeriod: '2026-07-25T14:28:17-06:00' },
    },
  ];

  it('verifies sparse metadata using the exact official discharge PDF', async () => {
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'QQ==' });
    const result = await verifyLocalOccupantsByExactEgreso([occupant], sparseLookup, {
      fetchDischargeReport: fetchReport,
      extractText: async () => officialText,
    });
    expect(fetchReport).toHaveBeenCalledWith('142083');
    expect(result.unresolved).toEqual([]);
    expect(result.verified).toEqual([
      expect.objectContaining({
        exactEgresoVerified: true,
        dischargeAt: '2026-07-25T14:28:17',
      }),
    ]);
  });

  it.each([
    ['another RUN', officialText.replace('6321880 - 4', '11111111 - 1')],
    ['different discharge minute', officialText.replace('1 4 - 2 8', '1 4 - 2 9')],
    ['incomplete PDF', '1.RUN: 6321880 - 4'],
  ])('does not verify sparse metadata with %s', async (_label, text) => {
    const result = await verifyLocalOccupantsByExactEgreso([occupant], sparseLookup, {
      fetchDischargeReport: async () => ({ base64: 'QQ==' }),
      extractText: async () => text,
    });
    expect(result.verified).toEqual([]);
    expect(result.unresolved).toEqual([occupant]);
  });

  it('does not override an explicit negative administrative discharge', async () => {
    const fetchReport = vi.fn();
    const result = await verifyLocalOccupantsByExactEgreso(
      [occupant],
      async () => [
        {
          ...(await sparseLookup())[0],
          egreso: {
            ...(await sparseLookup())[0].egreso,
            hasAdministrativeDischarge: false,
          },
        },
      ],
      { fetchDischargeReport: fetchReport, extractText: async () => officialText }
    );
    expect(result.verified).toEqual([]);
    expect(fetchReport).not.toHaveBeenCalled();
  });

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
