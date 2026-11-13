// Synthetic regressions for resolved and historical report collisions.
import { expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import { applyEgresoReport } from '@/features/rayen-import/domain/applyEgresoReport';
import { collectSafeClinicalEpisodeIds } from '@/features/rayen-import/hooks/rayenStructuralConvergence';

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
  fecha = '08-07-2026 12:00'
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
});
const mv = (rut: string, bedId: string, extra = {}) => ({
  id: `m-${rut}`,
  bedId,
  bedName: bedId,
  bedType: 'Adulto',
  patientName: 'HIST',
  rut,
  diagnosis: '',
  time: '09:00',
  status: 'Vivo' as const,
  ...extra,
});
const cases: Record<string, [EgresoReportRow[], DailyRecord]> = {
  // passport with exact episode; unrelated RUT patient with same digits in another bed
  exactEpisodeBlocked: [
    [row('P123456785', '1001')],
    rec({
      H5C1: person('P123456785', 'PASAPORTE', '1001'),
      H5C2: person('12.345.678-5', 'RUT', '2002', 'H5C2'),
    }),
  ],
  exactEpisodeAlone: [
    [row('P123456785', '1001')],
    rec({ H5C1: person('P123456785', 'PASAPORTE', '1001') }),
  ],
  // legacy (e) before and after staff discharge; bed reused by a new patient
  legacyInBed: [
    [row('1234567A')],
    rec({
      H5C1: person('123.456-7', 'LEGADO', '1001'),
      H5C2: person('11.111.111-1', 'OTRO', '3003', 'H5C2'),
    }),
  ],
  legacyAfterManualDischarge: [
    [row('1234567A')],
    rec({ H5C1: person('11.111.111-1', 'NUEVO', '3003') }, {
      discharges: [mv('123.456-7', 'H5C1')],
    } as Partial<DailyRecord>),
  ],
  legacyAfterManualDischargeWithEp: [
    [row('1234567A', '1001')],
    rec({ H5C1: person('11.111.111-1', 'NUEVO', '3003') }, {
      discharges: [mv('123.456-7', 'H5C1', { clinicalEpisodeId: '1001' })],
    } as Partial<DailyRecord>),
  ],
  // deleted discharge of another person with same digits
  deletedHistory: [
    [row('P123456785')],
    rec({ H5C1: person('P123456785', 'PASAPORTE') }, {
      discharges: [mv('12.345.678-5', 'H5C2', { deletedAt: '2026-07-08T10:00:00Z' })],
    } as Partial<DailyRecord>),
  ],
  // old rows (other days) colliding
  oldRowCollides3d: [
    [row('P123456785', undefined, 'H5C1', '05-07-2026 12:00')],
    rec({ H5C1: person('12.345.678-5', 'RUT', '1001') }),
  ],
  oldRowNoCollision3d: [
    [row('P123456785', undefined, 'H5C1', '05-07-2026 12:00')],
    rec({ H5C1: person('11.111.111-1', 'OTRO', '1001') }),
  ],
  oldRowCollides20d: [
    [row('P123456785', undefined, 'H5C1', '18-06-2026 12:00')],
    rec({ H5C1: person('12.345.678-5', 'RUT', '1001') }),
  ],
  // K interior stored with dots vs row without
  kInterior: [[row('12K3456785')], rec({ H5C1: person('12K.345.678-5', 'K', '1001') })],
  // mixed case passport w/ spaces
  passportSpaces: [[row('p 123-456.785')], rec({ H5C1: person('P123456785', 'PASAPORTE') })],
  // the original cross, with/without episode
  crossNoEp: [
    [row('P123456785')],
    rec({
      H5C1: person('12.345.678-5', 'RUT'),
      H5C2: person('11.111.111-1', 'OTRO', '3003', 'H5C2'),
    }),
  ],
  crossEp: [
    [row('P123456785')],
    rec({
      H5C1: person('12.345.678-5', 'RUT', '1001'),
      H5C2: person('11.111.111-1', 'OTRO', '3003', 'H5C2'),
    }),
  ],
  // RN free-text document under maternal RUN; mother's own RUT row
  rnFreeText: [
    [row('12.345.678-5', undefined)],
    rec({
      H5C1: {
        ...person('12.345.678-5', 'MADRE', '1001'),
        clinicalCrib: person('RN 12.345.678-5', 'RN', 'RN1'),
      },
    }),
  ],
};
it.each([
  'legacyAfterManualDischarge',
  'legacyAfterManualDischargeWithEp',
  'deletedHistory',
  'oldRowCollides20d',
  'exactEpisodeBlocked',
])('preserves actionable outcomes: %s', name => {
  const [rows, record] = cases[name];
  for (let sync = 0; sync < 2; sync++) {
    const result = applyEgresoReport(createEmptyCensusImportDiff(true), rows, record);
    expect(result.conflicts).toEqual([]);
    expect(result.discharges).toHaveLength(
      ['deletedHistory', 'exactEpisodeBlocked'].includes(name) ? 1 : 0
    );
    if (name.startsWith('legacyAfter'))
      expect(collectSafeClinicalEpisodeIds(record, result.conflicts)).toEqual(['3003']);
  }
});
