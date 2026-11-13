// Permanent synthetic regressions for report document identity.
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

it.each([
  'principal',
  'crib',
  'admission',
  'admitted-crib',
  'move',
  'update',
  'pending',
  'active-crib',
  'conflict',
  'discharge',
] as const)('retains plans and exposes collision in %s', location => {
  const rec = record('99.999.999-9');
  const diff = createEmptyCensusImportDiff(true);
  const patient = occupant('12.345.678-5');
  const source = {
    encounterId: 'SYNTHETIC',
    run: patient.rut,
    firstGivenName: 'SINTETICO',
    firstFamilyName: 'PRUEBA',
    service: '',
    room: 'H5',
    bed: 'C1',
  };
  if (location === 'principal') rec.beds.H5C1 = patient;
  if (location === 'crib') rec.beds.H5C1.clinicalCrib = patient;
  if (location === 'admission') diff.admissions.push({ bedId: 'H5C2', patient, isCma: false });
  if (location === 'admitted-crib')
    diff.admissions.push({
      bedId: 'H5C2',
      patient: { ...occupant('99.999.999-9'), clinicalCrib: patient },
      isCma: false,
    });
  if (location === 'move')
    diff.moves.push({
      fromBedId: 'H5C1',
      toBedId: 'H5C2',
      rut: patient.rut,
      patientName: patient.patientName,
      source,
    });
  if (location === 'update')
    diff.updates.push({
      bedId: 'H5C1',
      rut: patient.rut,
      patientName: patient.patientName,
      patient,
      changes: [{ field: 'clinicalCrib', from: patient, to: undefined }],
    });
  if (location === 'pending')
    diff.pendingAdministrativeDischarges.push({
      bedId: 'H5C1',
      rut: patient.rut,
      patientName: patient.patientName,
      signal: 'clinical-closure',
      verification: {
        medicalEpicrisis: 'confirmed',
        nursingEpicrisis: 'unknown',
        hospitalDischarge: 'not-detected',
      },
    });
  if (location === 'active-crib')
    diff.activeClinicalCribs = [{ parentBedId: 'H5C1', patient, source }];
  if (location === 'conflict')
    diff.conflicts.push({ bedId: 'H5C1', rut: patient.rut, reason: 'SYNTHETIC' });
  if (location === 'discharge')
    diff.discharges.push({
      bedId: 'H5C2',
      rut: patient.rut,
      patientName: patient.patientName,
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
    });
  const result = applyEgresoReport(diff, [row('P123456785', '08-07-2026 12:00')], rec);
  expect(result.discharges).toEqual(diff.discharges);
  const onlyContext = location === 'active-crib' || location === 'conflict';
  expect(result.reportEgresos ?? []).toHaveLength(onlyContext ? 1 : 0);
  expect(result.admissions).toEqual(diff.admissions);
  expect(result.moves).toEqual(diff.moves);
  expect(result.updates).toEqual(diff.updates);
  expect(result.pendingAdministrativeDischarges).toEqual(diff.pendingAdministrativeDischarges);
  expect(result.conflicts).toHaveLength(onlyContext ? 0 : diff.conflicts.length + 1);
  if (!onlyContext) expect(result.conflicts.at(-1)?.bedId).toBe('H5C1');
});
it.each(['08-07-2026 12:00', '07-07-2026 12:00'])(
  'keeps legacy truncated documents visible (%s)',
  stamp => {
    const result = applyEgresoReport(
      createEmptyCensusImportDiff(true),
      [row('1234567A', stamp)],
      record('123.456-7')
    );
    expect(result.discharges).toEqual([]);
    expect(result.reportEgresos ?? []).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
  }
);

it('keeps the exact passport episode ahead of an episode-less duplicate', () => {
  const rec = record('P123456785');
  rec.beds.H5C1.clinicalEpisodeId = '1001';
  rec.beds.H5C2 = { ...occupant('99.999.999-9'), bedId: 'H5C2' };
  const diff = createEmptyCensusImportDiff(true);
  diff.unchangedCount = 2;
  diff.summary.unchanged = 2;
  const result = applyEgresoReport(
    diff,
    [
      row('p-123456785', '08-07-2026 12:00'),
      { ...row('P123456785', '08-07-2026 12:00'), encounterId: '1001' },
    ],
    rec
  );
  expect(result.discharges).toHaveLength(1);
  expect(result.discharges[0].encounterId).toBe('1001');
  expect(result.conflicts).toEqual([]);
  expect(result.unchangedCount).toBe(1);
  expect(result.summary.unchanged).toBe(1);
});

it.each(['discharges', 'transfers', 'cma'] as const)(
  'does not raise a collision for recorded history in %s',
  collection => {
    const rec = record('99.999.999-9');
    const movement = {
      id: 'synthetic-movement',
      bedId: 'H5C2',
      bedName: 'H5C2',
      bedType: 'Adulto',
      patientName: 'HISTORIA SINTETICA',
      rut: '12.345.678-5',
      diagnosis: '',
      time: '12:00',
      status: 'Vivo' as const,
    };
    const withHistory = { ...rec, [collection]: [movement] } as DailyRecord;
    const result = applyEgresoReport(
      createEmptyCensusImportDiff(true),
      [row('P123456785', '08-07-2026 12:00')],
      withHistory
    );
    expect(result.discharges).toEqual([]);
    expect(result.reportEgresos ?? []).toEqual([]);
    expect(result.conflicts).toEqual([]);
  }
);
it('still discharges the same passport in an attached crib', () => {
  const rec = record('99.999.999-9');
  rec.beds.H5C1.clinicalCrib = occupant('P123456785');
  const result = applyEgresoReport(
    createEmptyCensusImportDiff(true),
    [row('p-123 456785', '08-07-2026 12:00')],
    rec
  );
  expect(result.discharges).toEqual([]);
  expect(result.reportEgresos).toHaveLength(1);
  expect(result.reportEgresos?.[0].fromClinicalCrib).toBe(true);
  expect(result.updates[0].changes).toMatchObject([{ field: 'clinicalCrib', to: undefined }]);
  expect(result.conflicts).toEqual([]);
});

it.each(['principal', 'crib'] as const)(
  'accepts a legacy document with an exact %s episode',
  location => {
    const rec = record('99.999.999-9');
    const patient = { ...occupant('123.456-7'), clinicalEpisodeId: '777' };
    if (location === 'principal') rec.beds.H5C1 = patient;
    else rec.beds.H5C1.clinicalCrib = patient;
    const result = applyEgresoReport(
      createEmptyCensusImportDiff(true),
      [
        {
          ...row('1234567A', '08-07-2026 12:00'),
          encounterId: '777',
          exactEpisodeVerification: 'verified',
        },
      ],
      rec
    );
    expect(result.conflicts).toEqual([]);
    if (location === 'principal') expect(result.discharges).toMatchObject([{ encounterId: '777' }]);
    else {
      expect(result.reportEgresos).toMatchObject([{ encounterId: '777', fromClinicalCrib: true }]);
      expect(result.updates[0].changes).toMatchObject([{ field: 'clinicalCrib', to: undefined }]);
    }
  }
);
