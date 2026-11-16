// @vitest-environment node
// A passport HHR always read as one (P123456785) and another person's RUT with the same digits
// (12.345.678-5) are two people in every step of the discharge report. Synthetic data only.
import { expect, it } from 'vitest';
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
const row = (run: string, ep?: string): EgresoReportRow => ({
  run,
  ...(ep ? { encounterId: ep } : {}),
  patientName: 'REPORTE',
  bedLabel: 'H5C1',
  fechaEgreso: '08-07-2026 12:00',
  servicio: '',
  edad: '',
  destino: 'Domicilio',
  motivo: 'Alta',
});
const otherPersonsDischarge = {
  id: 'other',
  bedId: 'H5C4',
  bedName: 'H5C4',
  bedType: 'Adulto',
  patientName: 'OTRA PERSONA',
  rut: '12.345.678-5',
  diagnosis: '',
  time: '09:00',
  status: 'Vivo' as const,
};
const motherWithCrib = (crib: PatientData): DailyRecord['beds'] => ({
  H5C1: { ...person('11.111.111-1', 'MADRE', '9001'), clinicalCrib: crib },
});

it.each(['P123456785', 'p-123 456785'])(
  'a newborn with passport leaves the crib with its egreso although another RUT with its digits was discharged (%s)',
  reported => {
    const record = rec(motherWithCrib(person('P123456785', 'RN')), {
      discharges: [otherPersonsDischarge],
    } as Partial<DailyRecord>);
    for (const sync of [0, 1]) {
      const result = applyEgresoReport(createEmptyCensusImportDiff(true), [row(reported)], record);
      // Before, the crib was emptied and the other person's discharge stood in for this egreso.
      expect(result.updates, `sync ${sync}`).toMatchObject([
        { bedId: 'H5C1', changes: [{ field: 'clinicalCrib', to: undefined }] },
      ]);
      expect(result.reportEgresos, `sync ${sync}`).toMatchObject([
        { run: 'P123456785', fromClinicalCrib: true },
      ]);
      expect(result.conflicts).toEqual([]);
    }
  }
);

it('the RUT patient discharged earlier still explains its own repeated row', () => {
  const record = rec({}, { discharges: [otherPersonsDischarge] } as Partial<DailyRecord>);
  const result = applyEgresoReport(createEmptyCensusImportDiff(true), [row('123456785')], record);
  expect(result.reportEgresos ?? []).toEqual([]);
  expect(result.conflicts).toEqual([]);
});

it("a passport row with its own episode does not take the episode of the RUT patient's bed", () => {
  const record = rec({
    ...motherWithCrib(person('P123456785', 'RN')),
    H5C2: person('12.345.678-5', 'OTRA PERSONA', '2002', 'H5C2'),
  });
  const result = applyEgresoReport(
    createEmptyCensusImportDiff(true),
    [row('P123456785', '1001')],
    record
  );
  // Before, 2002 counted as the newborn's active episode and the egreso was filed as an old
  // stay while the crib stayed occupied, without review. Now the crib's unconfirmed episode is
  // reviewed, as for any document.
  expect(result.reportEgresos ?? []).toEqual([]);
  expect(result.discharges).toEqual([]);
  expect(result.conflicts).toMatchObject([{ bedId: 'H5C1', rut: 'P123456785' }]);
});

it('two people whose documents share digits each leave their own bed', () => {
  const record = rec({
    H5C1: person('P123456785', 'PASAPORTE'),
    H5C2: person('12.345.678-5', 'RUT', undefined, 'H5C2'),
  });
  const rows = [row('P123456785'), { ...row('12.345.678-5'), bedLabel: 'H5C2' }];
  const once = applyEgresoReport(createEmptyCensusImportDiff(true), rows, record);
  for (const result of [once, applyEgresoReport(once, rows, record)]) {
    expect(result.discharges.map(entry => [entry.bedId, entry.rut])).toEqual([
      ['H5C1', 'P123456785'],
      ['H5C2', '12.345.678-5'],
    ]);
    expect(result.conflicts).toEqual([]);
  }
});
