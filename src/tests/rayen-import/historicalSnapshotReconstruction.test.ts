import { describe, expect, it, vi } from 'vitest';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';

const emptyRecord = { date: '2026-07-24', beds: {} } as DailyRecord;

const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-25T13:00:00-06:00',
  facilityId: 1342,
  isComplete: true,
  encounters: [
    {
      encounterId: '142040',
      run: '11.111.111-1',
      firstGivenName: 'Paciente',
      firstFamilyName: 'Trazable',
      admissionDatetime: '2026-07-24T11:00:00-06:00',
      room: 'Neo 1',
      bed: 'Neo1',
      hasMedicalDischarge: true,
      hasNurseDischarge: true,
      dischargeDatetime: '2026-07-25T12:00:00-06:00',
    },
    {
      encounterId: '142099',
      run: '22.222.222-2',
      firstGivenName: 'Ingreso',
      firstFamilyName: 'Posterior',
      admissionDatetime: '2026-07-25T10:00:00-06:00',
    },
  ],
};

const flowText = `
Flujo del Paciente RUN: 111111111
24/07/2026 11:00:00 Servicio Estación Neo 1 Básica Neo1
25/07/2026 08:30:00 Servicio Estación Habitación 2 Básica C2
25/07/2026 09:10:00 Servicio Estación Habitación 3 Básica C1
`;

const statisticalDischargeText = `
1.RUN:
6321880 - 4
24 INGRESO 1 6 - 4 1 2 4 - 0 7 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
25 1er TRASLADO - - -
26 2° TRASLADO - - -
27 3er TRASLADO - - -
28 4° TRASLADO * - - -
29 EGRESO 1 4 - 2 8 2 5 - 0 7 - 2 6 1. Domicilio. 4 0 4
`;

describe('historical snapshot reconstruction', () => {
  it('projects D-1 to the last proven bed before the weekend 09:00 handoff', async () => {
    const fetchReport = vi.fn().mockResolvedValue({ base64: 'QQ==' });
    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      snapshot,
      emptyRecord,
      [],
      { fetchReport, extractText: async () => flowText }
    );

    expect(fetchReport).toHaveBeenCalledOnce();
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.isComplete).toBe(false);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '142040',
        hasMedicalDischarge: false,
        hasNurseDischarge: false,
        dischargeDatetime: undefined,
        verifiedBedPlacement: expect.objectContaining({
          bedId: 'H2C2',
          changedAt: '2026-07-25T08:30:00',
        }),
      }),
    ]);
  });

  it('uses the selected D-7 cutoff instead of projecting the current bed backwards', async () => {
    const historicalFlow = `
Flujo del Paciente RUN: 111111111
18/07/2026 10:00:00 Servicio Estación Neo 1 Básica Neo1
19/07/2026 08:30:00 Servicio Estación Habitación 2 Básica C2
19/07/2026 09:10:00 Servicio Estación Habitación 3 Básica C1
`;
    const longStaySnapshot: RayenCensusSnapshot = {
      ...snapshot,
      encounters: [
        {
          ...snapshot.encounters[0],
          admissionDatetime: '2026-07-15T11:00:00-06:00',
          room: 'Habitación 3',
          bed: 'C1',
          hasMedicalDischarge: false,
          hasNurseDischarge: false,
          dischargeDatetime: undefined,
        },
      ],
    };

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-18',
      longStaySnapshot,
      { ...emptyRecord, date: '2026-07-18' },
      [],
      {
        fetchReport: async () => ({ base64: 'QQ==' }),
        extractText: async () => historicalFlow,
      }
    );

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '142040',
        verifiedBedPlacement: expect.objectContaining({
          bedId: 'H2C2',
          changedAt: '2026-07-19T08:30:00',
        }),
      }),
    ]);
  });

  it('fails closed when report identity cannot prove the episode', async () => {
    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      snapshot,
      emptyRecord,
      [],
      {
        fetchReport: async () => ({ base64: 'QQ==' }),
        extractText: async () => flowText.replace('111111111', '333333333'),
      }
    );

    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        patientName: 'Paciente Trazable',
        reason: expect.stringContaining('RUN'),
      }),
    ]);
  });

  it('joins an exact report-only episode that disappeared before HHR ever recorded it', async () => {
    const reportRows = [
      {
        run: '11.111.111-1',
        encounterId: '142040',
        patientName: 'Paciente Egresado',
        bedLabel: 'H2C2',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        // 09:30 Rapa Nui: after Saturday's 09:00 close, so the patient occupied D-1 at cutoff.
        fechaEgreso: '25-07-2026 11:30',
      },
    ] satisfies EgresoReportRow[];
    const liveWithoutDeparture = { ...snapshot, encounters: [snapshot.encounters[1]] };

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      liveWithoutDeparture,
      emptyRecord,
      reportRows,
      {
        fetchReport: async () => ({ base64: 'QQ==' }),
        extractText: async () => flowText,
      }
    );

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '142040',
        verifiedBedPlacement: expect.objectContaining({ bedId: 'H2C2' }),
      }),
    ]);
  });

  it('ignores a report-only episode whose first official movement is after the cutoff', async () => {
    const reportRows = [
      {
        run: '22.222.222-2',
        encounterId: '142099',
        patientName: 'Ingreso Posterior',
        bedLabel: 'H3C1',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: '25-07-2026 14:00',
      },
    ] satisfies EgresoReportRow[];
    const postCutoffFlow = `
Flujo del Paciente RUN: 222222222
25/07/2026 10:00:00 Servicio Estación Habitación 3 Básica C1
`;

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      emptyRecord,
      reportRows,
      {
        fetchReport: async () => ({ base64: 'QQ==' }),
        extractText: async () => postCutoffFlow,
      }
    );

    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('excludes an episode whose authoritative discharge occurred before the cutoff', async () => {
    const reportRows = [
      {
        run: '11.111.111-1',
        encounterId: '142040',
        patientName: 'Paciente Trazable',
        bedLabel: 'H2C2',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        // 08:30 Rapa Nui: still belongs to D-1 and occurred before its 09:00 close.
        fechaEgreso: '25-07-2026 10:30',
      },
    ] satisfies EgresoReportRow[];

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      snapshot,
      emptyRecord,
      reportRows,
      {
        fetchReport: async () => ({ base64: 'QQ==' }),
        extractText: async () => flowText,
      }
    );

    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('surfaces an exact report episode whose identity or egreso time cannot be verified', async () => {
    const invalidRows = [
      {
        run: '',
        encounterId: '142777',
        patientName: 'Paciente Incompleto',
        bedLabel: 'NEO1',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: 'sin fecha',
      },
    ] satisfies EgresoReportRow[];
    const fetchReport = vi.fn();

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      emptyRecord,
      invalidRows,
      { fetchReport }
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        patientName: 'Paciente Incompleto',
        reason: expect.stringContaining('RUN y fecha de egreso inválidos'),
      }),
    ]);
  });

  it('surfaces a report-only patient without a verifiable encounter ID', async () => {
    const rows = [
      {
        run: '77.777.777-7',
        encounterId: '',
        patientName: 'Paciente Sin Episodio',
        bedLabel: 'NEO1',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: '25-07-2026 11:30',
      },
    ] satisfies EgresoReportRow[];

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      emptyRecord,
      rows,
      { fetchReport: vi.fn() }
    );

    expect(result.conflicts).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('episodio clínico verificable') }),
    ]);
  });

  it('surfaces a local occupant absent from both external sources', async () => {
    const localRecord = {
      date: '2026-07-24',
      beds: {
        NEO1: {
          patientName: 'Paciente Solo Local',
          rut: '33.333.333-3',
          clinicalEpisodeId: '142888',
          admissionDate: '2026-07-23',
        },
      },
    } as unknown as DailyRecord;
    const fetchReport = vi.fn();

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      localRecord,
      [],
      { fetchReport }
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        patientName: 'Paciente Solo Local',
        reason: expect.stringContaining('no aparece en Ficha Médico'),
      }),
    ]);
  });

  it('preserves a known D-1 bed when the exact egreso proves the interval and no transfer', async () => {
    const localRecord = {
      date: '2026-07-24',
      beds: {
        NEO1: {
          patientName: 'Paciente Egresado',
          rut: '6.321.880-4',
          clinicalEpisodeId: '142083',
          admissionDate: '2026-07-24',
          admissionTime: '16:41',
        },
      },
    } as unknown as DailyRecord;
    const fetchReport = vi.fn(async () => ({ base64: '', error: 'Sin trazabilidad' }));
    const fetchDischargeReport = vi.fn(async () => ({ base64: 'QQ==' }));
    const lookupEgresos = vi.fn(async () => [
      {
        run: '63218804',
        encounterId: '142083',
        egreso: { id: 142083, dateDischarge: '2026-07-25T14:28:00' },
      },
    ]);

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      localRecord,
      [],
      {
        fetchReport,
        fetchDischargeReport,
        lookupEgresos,
        extractText: async () => statisticalDischargeText,
      }
    );

    expect(lookupEgresos).toHaveBeenCalledWith([{ run: '6.321.880-4', encounterId: '142083' }]);
    expect(fetchReport).toHaveBeenCalledWith('142083');
    expect(fetchDischargeReport).toHaveBeenCalledWith('142083');
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '142083',
        verifiedBedPlacement: {
          source: 'statistical-discharge-interval',
          bedId: 'NEO1',
          changedAt: '2026-07-24T16:41:00',
        },
      }),
    ]);
  });

  it('excludes a local-only episode whose exact administrative discharge predates the cutoff', async () => {
    const localRecord = {
      date: '2026-07-24',
      beds: {
        NEO1: {
          patientName: 'Paciente Egresado Temprano',
          rut: '6.321.880-4',
          clinicalEpisodeId: '142083',
          admissionDate: '2026-07-24',
          admissionTime: '16:41',
        },
      },
    } as unknown as DailyRecord;
    const fetchReport = vi.fn();

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      localRecord,
      [],
      {
        fetchReport,
        lookupEgresos: async () => [
          {
            run: '63218804',
            encounterId: '142083',
            egreso: { id: 142083, dateDischarge: '2026-07-25T08:30:00' },
          },
        ],
      }
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([]);
  });

  it('does not preserve the local bed when the exact egreso records a prior unit transfer', async () => {
    const localRecord = {
      date: '2026-07-24',
      beds: {
        NEO1: {
          patientName: 'Paciente Trasladado',
          rut: '6.321.880-4',
          clinicalEpisodeId: '142083',
          admissionDate: '2026-07-24',
        },
      },
    } as unknown as DailyRecord;
    const reportWithTransfer = statisticalDischargeText.replace(
      '25 1er TRASLADO - - -',
      '25 1er TRASLADO 0 7 - 3 0 2 5 - 0 7 - 2 6 Unidad Crítica 4 0 5'
    );

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      localRecord,
      [],
      {
        fetchReport: async () => ({ base64: '', error: 'Sin trazabilidad' }),
        fetchDischargeReport: async () => ({ base64: 'QQ==' }),
        lookupEgresos: async () => [
          {
            run: '63218804',
            encounterId: '142083',
            egreso: { id: 142083, dateDischarge: '2026-07-25T14:28:00' },
          },
        ],
        extractText: async () => reportWithTransfer,
      }
    );

    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('traslado previo') }),
    ]);
  });

  it('shows one review item when an incomplete report row and a local episode name the same RUN', async () => {
    const localRecord = {
      date: '2026-07-24',
      beds: {
        NEO1: {
          patientName: 'Paciente Duplicado',
          rut: '77.777.777-7',
          clinicalEpisodeId: '142889',
          admissionDate: '2026-07-23',
        },
      },
    } as unknown as DailyRecord;
    const rows = [
      {
        run: '77.777.777-7',
        encounterId: '',
        patientName: 'Paciente Duplicado',
        bedLabel: 'NEO1',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: '25-07-2026 11:30',
      },
    ] satisfies EgresoReportRow[];

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      localRecord,
      rows,
      { fetchReport: vi.fn() }
    );

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: 'historical-reconstruction',
        patientName: 'Paciente Duplicado',
        source: expect.objectContaining({ encounterId: '142889' }),
      }),
    ]);
  });
});
