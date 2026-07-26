import { describe, expect, it, vi } from 'vitest';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

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
    },
  ],
};

describe('historical reconstruction identity and clinical-day guards', () => {
  it('rejects a report-backed clinical crib when its maternal relationship would be lost', async () => {
    const cribRecord = {
      date: '2026-07-24',
      beds: {
        H2C1: {
          patientName: '',
          clinicalCrib: {
            patientName: 'RN de Madre',
            rut: '55.555.555-5',
            clinicalEpisodeId: '142901',
            admissionDate: '2026-07-24',
          },
        },
      },
    } as unknown as DailyRecord;
    const rows = [
      {
        run: '55.555.555-5',
        encounterId: '142901',
        patientName: 'RN de Madre',
        bedLabel: 'H2C1',
        servicio: 'Pediatría',
        edad: '1 día',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: '25-07-2026 11:30',
      },
    ] satisfies EgresoReportRow[];
    const fetchReport = vi.fn();

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      cribRecord,
      rows,
      { fetchReport }
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('vínculo materno') }),
    ]);
  });

  it('rejects contradictory RUNs for the same live and administrative episode', async () => {
    const rows = [
      {
        run: '66.666.666-6',
        encounterId: '142040',
        patientName: 'Otra Identidad',
        bedLabel: 'H2C2',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: '25-07-2026 11:30',
      },
    ] satisfies EgresoReportRow[];
    const fetchReport = vi.fn();

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      snapshot,
      emptyRecord,
      rows,
      { fetchReport }
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('contradice') }),
    ]);
  });

  it('rejects contradictory RUNs for the same local and administrative episode', async () => {
    const localRecord = {
      date: '2026-07-24',
      beds: {
        NEO1: {
          patientName: 'Paciente Local',
          rut: '11.111.111-1',
          clinicalEpisodeId: '142040',
          admissionDate: '2026-07-23',
        },
      },
    } as unknown as DailyRecord;
    const rows = [
      {
        run: '66.666.666-6',
        encounterId: '142040',
        patientName: 'Otra Identidad',
        bedLabel: 'NEO1',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: '25-07-2026 11:30',
      },
    ] satisfies EgresoReportRow[];
    const fetchReport = vi.fn();

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      { ...snapshot, encounters: [] },
      localRecord,
      rows,
      { fetchReport }
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(result.snapshot.encounters).toEqual([]);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('contradice') }),
    ]);
  });

  it('does not shift an already corrected early-morning discharge back a second clinical day', async () => {
    const rows = [
      {
        run: '11.111.111-1',
        encounterId: '142040',
        patientName: 'Paciente Trazable',
        bedLabel: 'NEO1',
        servicio: 'AMQI',
        edad: '40 años',
        destino: 'Domicilio',
        motivo: 'Alta',
        fechaEgreso: 'sin usar',
        correctedDay: '2026-07-24',
        correctedTime: '03:00',
      },
    ] satisfies EgresoReportRow[];
    const historicalSnapshot = {
      ...snapshot,
      encounters: [{ ...snapshot.encounters[0], admissionDatetime: '2026-07-23T13:00:00-06:00' }],
    };
    const historicalFlow = `
Flujo del Paciente RUN: 111111111
23/07/2026 13:00:00 Servicio Estación Neo 1 Básica Neo1
`;

    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-23',
      historicalSnapshot,
      { ...emptyRecord, date: '2026-07-23' },
      rows,
      {
        fetchReport: async () => ({ base64: 'QQ==' }),
        extractText: async () => historicalFlow,
      }
    );

    expect(result.conflicts).toEqual([]);
    expect(result.snapshot.encounters).toEqual([
      expect.objectContaining({ encounterId: '142040' }),
    ]);
  });
});
