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

it('preserves a known historical crib after both exact episodes leave the live census', async () => {
  const { EMPTY_PATIENT } = await import('@/constants/patient');
  const mother = {
    ...EMPTY_PATIENT,
    bedId: 'H4C1',
    patientName: 'Madre sintética',
    rut: '17.059.646-3',
    clinicalEpisodeId: '143100',
    admissionDate: '2026-07-24',
    admissionTime: '14:00',
  };
  const child = {
    ...EMPTY_PATIENT,
    bedId: 'H4C1',
    bedMode: 'Cuna' as const,
    patientName: 'RN de Madre sintética',
    rut: '',
    neonatalMaternalRut: mother.rut,
    clinicalEpisodeId: '143101',
    admissionDate: '2026-07-24',
    admissionTime: '15:00',
  };
  const record = {
    date: '2026-07-25',
    beds: { H4C1: { ...mother, clinicalCrib: child } },
    discharges: [],
    transfers: [],
    cma: [],
  } as unknown as DailyRecord;
  const row = {
    run: mother.rut,
    patientName: mother.patientName,
    bedLabel: 'H4C1',
    servicio: 'AMQI',
    edad: '30',
    destino: 'Domicilio',
    motivo: 'Alta',
    fechaEgreso: '26-07-2026 16:00',
    correctedDay: '2026-07-26',
    correctedTime: '14:00',
    encounterId: mother.clinicalEpisodeId,
    exactEpisodeVerification: 'verified' as const,
  };
  const result = await reconstructHistoricalSnapshotAtClose(
    record.date,
    { capturedAt: '2026-07-27T12:00:00Z', facilityId: 1342, encounters: [] },
    record,
    [
      row,
      {
        ...row,
        run: '',
        patientName: child.patientName,
        encounterId: child.clinicalEpisodeId,
        fromClinicalCrib: true,
      },
    ],
    {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'QQ==' }),
      extractText: async () =>
        `Flujo del Paciente RUN: 170596463\n24/07/2026 14:00:00 Servicio Estación Habitación 4 Básica C1`,
    }
  );
  expect(result.conflicts).toEqual([]);
  expect(result.snapshot.encounters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        encounterId: child.clinicalEpisodeId,
        clinicalCribParentBedId: 'H4C1',
        run: '',
      }),
    ])
  );
  const unknown = { ...record, beds: { H4C1: { ...mother, clinicalCrib: undefined } } };
  const rejected = await reconstructHistoricalSnapshotAtClose(
    record.date,
    { capturedAt: '2026-07-27T12:00:00Z', facilityId: 1342, encounters: [] },
    unknown,
    [
      row,
      {
        ...row,
        run: '',
        patientName: child.patientName,
        encounterId: child.clinicalEpisodeId,
        fromClinicalCrib: true,
      },
    ],
    {
      fetchReport: vi.fn().mockResolvedValue({ base64: 'QQ==' }),
      extractText: async () =>
        `Flujo del Paciente RUN: 170596463\n24/07/2026 14:00:00 Servicio Estación Habitación 4 Básica C1`,
    }
  );
  expect(rejected.conflicts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({ encounterId: child.clinicalEpisodeId }),
      }),
    ])
  );
});

it('keeps filed mother and crib departures out of occupancy after their own census night closes', async () => {
  const { EMPTY_PATIENT } = await import('@/constants/patient');
  const mother = {
    ...EMPTY_PATIENT,
    patientName: 'Madre sintética',
    clinicalEpisodeId: '143100',
    rut: '17.059.646-3',
  };
  const child = {
    ...EMPTY_PATIENT,
    patientName: 'RN de Madre sintética',
    clinicalEpisodeId: '143101',
    rut: '',
    neonatalMaternalRut: mother.rut,
    bedMode: 'Cuna' as const,
  };
  const record = {
    date: '2026-07-25',
    beds: { H4C1: { ...EMPTY_PATIENT } },
    discharges: [
      { id: 'mother', clinicalEpisodeId: mother.clinicalEpisodeId, originalData: mother },
      {
        id: 'child',
        clinicalEpisodeId: child.clinicalEpisodeId,
        originalData: child,
        isNested: true,
      },
    ],
    transfers: [],
    cma: [],
  } as unknown as DailyRecord;
  const row = {
    run: mother.rut,
    patientName: mother.patientName,
    bedLabel: 'H4C1',
    servicio: 'AMQI',
    edad: '30',
    destino: 'Domicilio',
    motivo: 'Alta',
    fechaEgreso: '26-07-2026 00:19',
    correctedDay: record.date,
    correctedTime: '00:19',
    encounterId: mother.clinicalEpisodeId,
    exactEpisodeVerification: 'verified' as const,
  };
  const fetchReport = vi.fn();
  const result = await reconstructHistoricalSnapshotAtClose(
    record.date,
    { capturedAt: '2026-07-27T12:00:00Z', facilityId: 1342, encounters: [] },
    record,
    [row, { ...row, run: '', encounterId: child.clinicalEpisodeId, fromClinicalCrib: true }],
    { fetchReport }
  );
  expect(result.conflicts).toEqual([]);
  expect(result.snapshot.encounters).toEqual([]);
  expect(fetchReport).not.toHaveBeenCalled();
});
