import { describe, expect, it, vi } from 'vitest';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { planRayenCensusImport } from '@/features/rayen-import/importRayenCensusUseCase';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

describe('historical mother and clinical crib reconstruction', () => {
  it.each([
    {
      distance: 'D-1',
      censusDay: '2026-07-25',
      admissionDay: '2026-07-26',
      flowDay: '26/07/2026',
    },
    {
      distance: 'D-7',
      censusDay: '2026-07-19',
      admissionDay: '2026-07-20',
      flowDay: '20/07/2026',
    },
  ])('reconstructs a new mother before attaching her newborn on $distance', async testCase => {
    const emptyRecord = { date: testCase.censusDay, beds: {} } as DailyRecord;
    const mother = {
      encounterId: '143100',
      run: '17.059.646-3',
      firstGivenName: 'Maeva Elisabet Maria',
      firstFamilyName: 'Tuki',
      secondFamilyName: 'Garcia',
      admissionDatetime: `${testCase.admissionDay}T03:27:00-06:00`,
      administrativeSex: 'Mujer',
      room: 'H4',
      bed: 'C1',
    };
    const newborn = {
      encounterId: '143101',
      run: '17.059.646-3',
      firstGivenName: 'RN de Maeva',
      firstFamilyName: 'Tuki',
      secondFamilyName: 'Garcia',
      admissionDatetime: `${testCase.admissionDay}T05:10:00-06:00`,
      administrativeSex: 'Hombre',
      room: 'CH4',
      bed: 'C1',
      clinicalCribParentBedId: 'H4C1',
    };
    const motherAndNewbornSnapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-27T10:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      // The source order is intentionally RN first: reconstruction must be dependency-driven.
      encounters: [newborn, mother],
    };
    const motherFlow = `
Flujo del Paciente RUN: 170596463
${testCase.flowDay} 03:27:00 Servicio Estación Habitación 4 Básica C1
`;
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'QQ==' });

    const result = await reconstructHistoricalSnapshotAtClose(
      testCase.censusDay,
      motherAndNewbornSnapshot,
      emptyRecord,
      [],
      { fetchReport, extractText: async () => motherFlow }
    );

    expect(fetchReport).toHaveBeenCalledOnce();
    expect(fetchReport).toHaveBeenCalledWith('143100');
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '143100',
        verifiedBedPlacement: expect.objectContaining({ bedId: 'H4C1' }),
      }),
      expect.objectContaining({
        encounterId: '143101',
        clinicalCribParentBedId: 'H4C1',
        verifiedBedPlacement: undefined,
      }),
    ]);

    const { diff } = planRayenCensusImport({
      current: emptyRecord,
      snapshot: result.snapshot,
      reference: new Date('2026-07-27T10:00:00-06:00'),
    });
    expect(diff.conflicts).toEqual([]);
    expect(diff.admissions).toHaveLength(1);
    expect(diff.admissions[0]).toMatchObject({
      bedId: 'H4C1',
      patient: {
        patientName: 'Maeva Elisabet Maria Tuki Garcia',
        clinicalCrib: {
          patientName: 'Rn De Maeva Tuki Garcia',
          clinicalEpisodeId: '143101',
        },
      },
    });
  });
});
