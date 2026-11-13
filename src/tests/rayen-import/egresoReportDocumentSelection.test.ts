import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import { applyEgresoReport } from '@/features/rayen-import/domain/applyEgresoReport';

const base = rayenToPatientData(
  {
    encounterId: 'S',
    run: '11.111.111-1',
    firstGivenName: 'S',
    firstFamilyName: 'P',
    birthDate: '1980-01-01',
    service: 'Área Médico Quirúrgica Indiferenciada',
    room: 'H5',
    bed: 'C1',
    admissionDatetime: '2026-07-01T10:00:00-06:00',
  },
  new Date('2026-07-08T20:00:00Z')
).patient;
const person = (rut: string, name: string, ep?: string, bedId = 'H5C1'): PatientData => ({
  ...base,
  bedId,
  rut,
  patientName: name,
  clinicalEpisodeId: ep,
  admissionDate: '2026-07-01',
  admissionTime: '10:00',
});
const rec = (beds: Record<string, PatientData>, extra: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-07-08',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    activeExtraBeds: [],
    ...extra,
  }) as DailyRecord;
const row = (
  run: string,
  ep?: string,
  bedLabel = 'H5C1',
  fecha = '08-07-2026 12:00',
  extra: Partial<EgresoReportRow> = {}
): EgresoReportRow => ({
  run,
  ...(ep ? { encounterId: ep } : {}),
  patientName: 'REPORTE',
  bedLabel,
  fechaEgreso: fecha,
  servicio: '',
  edad: '',
  destino: 'Domicilio',
  motivo: 'Alta',
  ...extra,
});

describe('episode-less report document selection', () => {
  it.each(['10:00', '22:00'])('retains the exact RUT row when its time is %s', time => {
    const r = rec({
      H5C1: person('12.345.678-5', 'RUT', '1001'),
      H5C2: person('P123456785', 'PAS', '4004', 'H5C2'),
    });
    const rows = [
      row('12.345.678-5', undefined, 'H5C1', `07-07-2026 ${time}`),
      row('P123456785', undefined, 'H5C2', `07-07-2026 ${time === '10:00' ? '22:00' : '10:00'}`),
    ];
    const once = applyEgresoReport(createEmptyCensusImportDiff(true), rows, r);
    for (const result of [once, applyEgresoReport(once, rows, r)]) {
      expect(result.discharges).toEqual([
        expect.objectContaining({ bedId: 'H5C1', encounterId: '1001', rut: '12.345.678-5' }),
      ]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ bedId: 'H5C2', rut: 'P123456785' });
    }
  });
  it.each(['10:00', '22:00'])('retains the exact passport row when its time is %s', time => {
    const r = rec({
      H5C2: person('P123456785', 'PAS', '4004', 'H5C2'),
      H5C1: person('12.345.678-5', 'RUT', '1001'),
    });
    const rows = [
      row('P123456785', undefined, 'H5C2', `07-07-2026 ${time}`),
      row('12.345.678-5', undefined, 'H5C1', `07-07-2026 ${time === '10:00' ? '22:00' : '10:00'}`),
    ];
    const once = applyEgresoReport(createEmptyCensusImportDiff(true), rows, r);
    for (const result of [once, applyEgresoReport(once, rows, r)]) {
      expect(result.discharges).toEqual([
        expect.objectContaining({ bedId: 'H5C2', encounterId: '4004', rut: 'P123456785' }),
      ]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toMatchObject({ bedId: 'H5C1', rut: '12.345.678-5' });
    }
  });
  it.each([
    ['12.345.678-5', '123456785'],
    ['P123456785', 'p-123 456785'],
  ])('keeps the latest row for the same document %s', (document, formatted) => {
    const r = rec({ H5C1: person(document, 'SINTETICO', '1001') });
    const early = row(document, undefined, 'H5C1', '07-07-2026 10:00');
    const late = row(formatted, undefined, 'H5C1', '07-07-2026 22:00');
    const expected = applyEgresoReport(createEmptyCensusImportDiff(true), [late], r);
    expect(expected.discharges).toHaveLength(1);
    for (const rows of [
      [early, late],
      [late, early],
    ]) {
      const once = applyEgresoReport(createEmptyCensusImportDiff(true), rows, r);
      expect(once).toEqual(expected);
      expect(applyEgresoReport(once, rows, r).discharges).toEqual(expected.discharges);
    }
  });
  it('discharges the passport occupant despite a routine RUT diagnosis update', () => {
    const r = rec({
      H5C2: person('P123456785', 'PAS', '4004', 'H5C2'),
      H5C1: person('12.345.678-5', 'RUT', '1001'),
    });
    const diff = createEmptyCensusImportDiff(true);
    diff.updates.push({
      bedId: 'H5C1',
      rut: '12.345.678-5',
      patientName: 'RUT',
      changes: [{ field: 'pathology', from: 'a', to: 'b' }],
      patient: r.beds.H5C1,
    });
    const result = applyEgresoReport(diff, [row('P123456785', undefined, 'H5C2')], r);
    expect(result.discharges).toEqual([
      expect.objectContaining({ bedId: 'H5C2', encounterId: '4004' }),
    ]);
    expect(result.conflicts).toEqual([]);
    expect(result.updates).toEqual(diff.updates);
  });
});
