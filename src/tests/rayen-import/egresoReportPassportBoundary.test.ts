// Sonda de escenarios E7e (temporal, sin commit). Se corre en head y con los cinco módulos de main.
import { describe, expect, it } from 'vitest';

import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import { applyEgresoReport } from '@/features/rayen-import/domain/applyEgresoReport';

const base = rayenToPatientData(
  {
    encounterId: 'SYNTHETIC',
    run: '11.111.111-1',
    firstGivenName: 'SINTETICO',
    firstFamilyName: 'PRUEBA',
    birthDate: '1980-01-01',
    service: 'Área Médico Quirúrgica Indiferenciada',
    room: 'H5',
    bed: 'C1',
    admissionDatetime: '2026-07-01T10:00:00-06:00',
  },
  new Date('2026-07-08T20:00:00Z')
).patient;
const occupant = (rut: string, name = 'OCUPANTE SINTETICO'): PatientData => ({
  ...base,
  rut,
  patientName: name,
  clinicalEpisodeId: undefined,
  admissionDate: '2026-07-01',
  admissionTime: '10:00',
});
const record = (rut: string): DailyRecord => ({
  date: '2026-07-08',
  beds: { H5C1: occupant(rut) },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});
const row = (
  run: string,
  fecha: string,
  verification?: EgresoReportRow['exactEpisodeVerification']
): EgresoReportRow => ({
  run,
  patientName: 'REPORTE SINTETICO',
  bedLabel: 'H5C1',
  fechaEgreso: fecha,
  ...(verification ? { exactEpisodeVerification: verification } : {}),
  servicio: '',
  edad: '',
  destino: 'Domicilio',
  motivo: 'Alta',
});

describe('passport report document boundary', () => {
  it.each([undefined, '1001'])('does not discharge a RUT occupant (episode %s)', episode => {
    const rec = record('12.345.678-5');
    rec.beds.H5C1.clinicalEpisodeId = episode;
    const result = applyEgresoReport(
      createEmptyCensusImportDiff(true),
      [row('P123456785', '08-07-2026 12:00')],
      rec
    );
    expect(result.discharges).toEqual([]);
    expect(result.reportEgresos ?? []).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].bedId).toBe('H5C1');
  });
  it.each([
    ['12.345.678-5', '123456785'],
    ['P123456785', 'p-123 456785'],
  ])('preserves matching %s / %s', (stored, reported) => {
    const result = applyEgresoReport(
      createEmptyCensusImportDiff(true),
      [row(reported, '08-07-2026 12:00')],
      record(stored)
    );
    expect(result.discharges).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
  });
});
