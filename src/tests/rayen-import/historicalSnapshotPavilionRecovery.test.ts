import { describe, expect, it, vi } from 'vitest';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

describe('historical pavilion recovery and active episode evidence', () => {
  const encodedReport = (text: string): string =>
    btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const extractText = async (buffer: ArrayBuffer): Promise<string> =>
    new TextDecoder().decode(buffer);

  it('omits episodes verified in P-R1/P-R2 at the historical cutoff without warnings', async () => {
    const pavilionSnapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-31T10:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [
        {
          encounterId: '150001',
          run: '18.658.570-4',
          firstGivenName: 'Tamarii',
          firstFamilyName: 'Tuki Hey',
          admissionDatetime: '2026-07-30T07:00:00-06:00',
          service: 'Recuperación Pabellón',
          room: 'Pabellón-R1',
          bed: 'P-R1',
        },
        {
          encounterId: '150002',
          run: '20.236.052-1',
          firstGivenName: 'Nicolas Segundo',
          firstFamilyName: 'Quezada Ika',
          admissionDatetime: '2026-07-30T07:10:00-06:00',
          service: 'Recuperación Pabellón',
          room: 'Pabellón-R2',
          bed: 'P-R2',
        },
      ],
    };
    const pavilionRecord = {
      date: '2026-07-30',
      beds: {
        R1: {
          patientName: 'Tamarii Tuki Hey',
          rut: '18.658.570-4',
          clinicalEpisodeId: '150001',
          location: 'Área quirúrgica indiferenciada / Pabellón-R1 / P-R1',
        },
        R2: {
          patientName: 'Nicolas Segundo Quezada Ika',
          rut: '20.236.052-1',
          clinicalEpisodeId: '150002',
          location: 'Área quirúrgica indiferenciada / Pabellón-R2 / P-R2',
        },
        R3: {
          patientName: 'Paciente Pabellón Local',
          rut: '17.777.777-7',
          clinicalEpisodeId: '150004',
          location: 'Área quirúrgica indiferenciada / Pabellón-R1 / P-R1',
        },
      },
    } as unknown as DailyRecord;
    const fetchReport = vi.fn(async (encounterId: string) => {
      const runByEpisode: Record<string, string> = {
        '150001': '186585704',
        '150002': '202360521',
        '150005': '166666666',
      };
      return {
        base64: encodedReport(`
Flujo del Paciente RUN: ${runByEpisode[encounterId]}
30/07/2026 07:00:00 Servicio Recuperacion Pabellon ${encounterId === '150001' ? 'P-R1' : 'P-R2'}
`),
      };
    });

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-30',
      pavilionSnapshot,
      pavilionRecord,
      [
        {
          run: '16.666.666-6',
          encounterId: '150005',
          patientName: 'Paciente Pabellón Reporte',
          bedLabel: 'P-R2',
          servicio: 'Recuperación Pabellón',
          edad: '30 años',
          destino: 'Domicilio',
          motivo: 'Alta',
          fechaEgreso: '31-07-2026 11:30',
        },
      ],
      { fetchReport, extractText }
    );

    expect(fetchReport).toHaveBeenCalledTimes(3);
    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('reconstructs the inpatient bed when a patient moved to P-R1 only after the cutoff', async () => {
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-31T10:30:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [
        {
          encounterId: '150006',
          run: '12.345.678-5',
          firstGivenName: 'Paciente',
          firstFamilyName: 'Historico',
          admissionDatetime: '2026-07-30T06:00:00-06:00',
          service: 'Recuperación Pabellón',
          room: 'Pabellón-R1',
          bed: 'P-R1',
        },
      ],
    };
    const historicalRecord = {
      date: '2026-07-30',
      beds: {
        H2C2: {
          patientName: 'Paciente Historico',
          rut: '12.345.678-5',
          clinicalEpisodeId: '150006',
        },
      },
    } as unknown as DailyRecord;
    const fetchReport = vi.fn().mockResolvedValue({
      base64: encodedReport(`
Flujo del Paciente RUN: 123456785
30/07/2026 06:00:00 Servicio Habitacion 2 Intermedia H2C2
31/07/2026 10:00:00 Servicio Recuperacion Pabellon P-R1
`),
    });

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-30',
      snapshot,
      historicalRecord,
      [],
      { fetchReport, extractText }
    );

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '150006',
        verifiedBedPlacement: expect.objectContaining({ bedId: 'H2C2' }),
      }),
    ]);
  });

  it('keeps a discharged report row as evidence when P-R1 happened after the cutoff', async () => {
    const historicalRecord = {
      date: '2026-07-30',
      beds: {
        H2C2: {
          patientName: 'Paciente Egresado',
          rut: '12.345.678-5',
          clinicalEpisodeId: '150007',
          admissionDate: '2026-07-30',
        },
      },
    } as unknown as DailyRecord;
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-31T12:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [],
    };
    const fetchReport = vi.fn().mockResolvedValue({
      base64: encodedReport(`
Flujo del Paciente RUN: 123456785
30/07/2026 06:00:00 Servicio Habitacion 2 Intermedia H2C2
31/07/2026 10:00:00 Servicio Recuperacion Pabellon P-R1
`),
    });

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-30',
      snapshot,
      historicalRecord,
      [
        {
          run: '12.345.678-5',
          encounterId: '150007',
          patientName: 'Paciente Egresado',
          bedLabel: 'P-R1',
          servicio: 'Recuperación Pabellón',
          edad: '40 años',
          destino: 'Domicilio',
          motivo: 'Alta',
          fechaEgreso: '31-07-2026 11:00',
        },
      ],
      { fetchReport, extractText }
    );

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '150007',
        verifiedBedPlacement: expect.objectContaining({ bedId: 'H2C2' }),
      }),
    ]);
  });

  it('recovers a Ficha Medico omission by clinical episode from active bed evidence', async () => {
    const reinaRecord = {
      date: '2026-07-30',
      beds: {
        R2: {
          patientName: 'Reina Haoa',
          firstName: 'Reina',
          lastName: 'Haoa',
          rut: '6.560.789-1',
          clinicalEpisodeId: '150003',
          admissionDate: '2026-07-29',
          location: 'Área Médico Quirúrgica Indiferenciada / Recuperación 2 / R2',
        },
      },
    } as unknown as DailyRecord;
    const activeBedSnapshot: RayenCensusSnapshot = {
      capturedAt: '2026-07-31T10:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [],
      activeBedAssignments: [{ encounterId: '150003', bedId: 'R2' }],
    };
    const reinaFlow = `
Flujo del Paciente RUN: 65607891
29/07/2026 16:00:00 Servicio Estación CMA R2 Intermedia R2
30/07/2026 07:00:00 Servicio Estación Recuperación 2 Intermedia R2
`;
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'QQ==' });

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-30',
      activeBedSnapshot,
      reinaRecord,
      [],
      { fetchReport, extractText: async () => reinaFlow }
    );

    expect(fetchReport).toHaveBeenCalledWith('150003');
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '150003',
        verifiedBedPlacement: expect.objectContaining({ bedId: 'R2' }),
      }),
    ]);
  });
});
