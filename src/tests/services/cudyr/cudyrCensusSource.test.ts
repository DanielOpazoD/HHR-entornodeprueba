import { describe, it, expect } from 'vitest';
import {
  parseCudyrCensusSource,
  applyCudyrCensusEvidence,
} from '@/services/cudyr/cudyrCensusSource';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { ArchivedCudyrCensus } from '@/types/domain/cudyrCensusEvidence';
const source = () =>
  ({
    id: 'source',
    date: '2026-08-01',
    observedAt: '2026-10-08T18:00:00Z',
    importedAt: '2026-10-08T18:01:00Z',
    source: {
      date: '2026-08-01',
      patients: [{ name: 'Paciente Uno', discharged: false, transferred: false, deceased: false }],
    },
  }) as ArchivedCudyrCensus;
const data = () =>
  ({
    generatedAt: '2026-10-08T19:00:00Z',
    coverage: [{ date: '2026-08-01', state: 'disponible' }],
    rows: [{ date: '2026-08-01', patientName: 'Paciente Uno' }],
  }) as CudyrReportDataset;
describe('historical census coverage', () => {
  it('does not reorder names when the daily source has no document', () => {
    const d = data(),
      s = source();
    d.rows[0].patientName = 'Ana Perez Soto';
    s.source.patients[0].name = 'Perez Soto Ana';
    expect(applyCudyrCensusEvidence(d, [s]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      missing: 1,
      extra: 1,
    });
  });
  it('does not explain a night admission whose underlying HHR timestamps conflict', () => {
    const d = data(),
      s = source(),
      next = source();
    next.id = 'next';
    next.date = next.source.date = '2026-08-02';
    s.source.patients = [];
    Object.assign(d.rows[0], {
      admissionDate: '2026-08-02',
      admissionTime: '02:38',
      admissionEvidenceConflict: true,
    });
    expect(applyCudyrCensusEvidence(d, [s, next]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      nightShiftMatched: 0,
      extra: 1,
    });
  });

  it('does not verify matching censuses when an official positive is absent from both', () => {
    const d = data();
    d.rows.push({
      ...d.rows[0],
      patientName: 'Paciente Nuevo',
      contextSource: 'eloisa_monthly_report',
      evaluation: { category: 'C2' },
    } as never);
    expect(applyCudyrCensusEvidence(d, [source()]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      unlinkedResults: 1,
    });
  });
  it('accepts the neighboring census after the target night closes, without waiting another day', () => {
    const d = data(),
      s = source(),
      next = source();
    d.generatedAt = '2026-08-02T18:10:00Z';
    for (const a of [s, next]) a.observedAt = a.importedAt = '2026-08-02T18:01:00Z';
    next.id = 'next';
    next.date = next.source.date = '2026-08-02';
    s.source.patients = [];
    Object.assign(d.rows[0], { admissionDate: '2026-08-02', admissionTime: '02:38' });
    expect(applyCudyrCensusEvidence(d, [s, next]).coverage[0].censusVerification).toMatchObject({
      state: 'verified',
      nightShiftMatched: 1,
    });
  });

  it('explains a next-calendar-day admission only with its HHR night and source counterpart', () => {
    const d = data(),
      s = source(),
      next = source();
    next.id = 'next';
    next.date = next.source.date = '2026-08-02';
    s.source.patients = [];
    Object.assign(d.rows[0], { admissionDate: '2026-08-02', admissionTime: '02:38' });
    expect(applyCudyrCensusEvidence(d, [s, next]).coverage[0].censusVerification).toMatchObject({
      state: 'verified',
      nightShiftMatched: 1,
      extra: 0,
      reportIds: ['source', 'next'],
    });
    d.rows[0].admissionTime = '09:00';
    expect(applyCudyrCensusEvidence(d, [s, next]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      extra: 1,
    });
  });
  it('does not infer overnight ownership without time or from an unrelated next-day patient', () => {
    const d = data(),
      s = source(),
      next = source();
    next.id = 'next';
    next.date = next.source.date = '2026-08-02';
    s.source.patients = [];
    d.rows[0].admissionDate = '2026-08-02';
    expect(applyCudyrCensusEvidence(d, [s, next]).coverage[0].censusVerification?.extra).toBe(1);
    d.rows[0].admissionTime = '02:38';
    next.source.patients[0].name = 'Otra Persona';
    expect(applyCudyrCensusEvidence(d, [s, next]).coverage[0].censusVerification?.extra).toBe(1);
  });
  it('uses an official positive as corroboration, not proof of census completeness', () => {
    const d = data(),
      s = source();
    s.source.patients = [];
    Object.assign(d.rows[0], {
      clinicalEpisodeId: 'episode',
      rut: 'id',
      monthlyEvidence: { state: 'found' },
      evaluation: { source: 'Eloísa', category: 'C2' },
    });
    expect(applyCudyrCensusEvidence(d, [s]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      resultBacked: 1,
      extra: 0,
    });
    d.rows[0].evaluation = null;
    expect(applyCudyrCensusEvidence(d, [s]).coverage[0].censusVerification?.extra).toBe(1);
  });
  it('does not remove a missing patient merely because they appeared in the previous night', () => {
    const d = data();
    d.rows = [
      { ...d.rows[0], date: '2026-07-31', admissionDate: '2026-08-01', admissionTime: '02:00' },
    ];
    expect(applyCudyrCensusEvidence(d, [source()]).coverage[0].censusVerification?.missing).toBe(1);
  });

  it('does not equate a saved HHR day to a complete population', () =>
    expect(applyCudyrCensusEvidence(data(), []).coverage[0].censusVerification?.state).toBe(
      'pending'
    ));
  it('verifies unique names in both directions and flags omissions/extra cases', () => {
    expect(applyCudyrCensusEvidence(data(), [source()]).coverage[0].censusVerification?.state).toBe(
      'verified'
    );
    const d = data();
    d.rows = [];
    expect(applyCudyrCensusEvidence(d, [source()]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      missing: 1,
    });
    const s = source();
    s.source.patients = [];
    expect(applyCudyrCensusEvidence(data(), [s]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      extra: 1,
    });
  });
  it('does not conceal missing HHR patients with monthly-only recovered rows', () => {
    const d = data();
    d.rows[0].contextSource = 'eloisa_monthly_report';
    expect(applyCudyrCensusEvidence(d, [source()]).coverage[0].censusVerification).toMatchObject({
      state: 'mismatch',
      missing: 1,
    });
  });
  it('does not collapse duplicate names into a verified census', () => {
    const s = source();
    s.source.patients.push({ ...s.source.patients[0] });
    expect(applyCudyrCensusEvidence(data(), [s]).coverage[0].censusVerification?.state).toBe(
      'mismatch'
    );
  });
  it('rejects a missing transfer header instead of reading the final cell', () => {
    expect(() =>
      parseCudyrCensusSource({
        sheet: 'Censo diario de pacientes',
        rows: [
          ['CENSO DIARIO DE PACIENTES'],
          ['Fecha: 01-08-2026'],
          ['N°', 'NOMBRES Y APELLIDOS', 'ALTA', 'FALLECIDO'],
          [1, 'Paciente Uno', 'NO', 'NO'],
        ],
      })
    ).toThrow('Formato de censo Eloísa no reconocido');
  });
  it('parses an observed source layout and rejects unknown movement flags', () => {
    const matrix = {
      sheet: 'Censo diario de pacientes',
      rows: [
        ['CENSO DIARIO DE PACIENTES'],
        ['Fecha: 01-08-2026'],
        ['N°', 'NOMBRES Y APELLIDOS', 'ALTA', 'TRASLADO', 'FALLECIDO'],
        [1, 'Paciente Uno', 'NO', 'NO', 'NO'],
      ],
    };
    expect(parseCudyrCensusSource(matrix)).toMatchObject({
      date: '2026-08-01',
      patients: [{ name: 'Paciente Uno' }],
    });
    matrix.rows[3][2] = '';
    expect(() => parseCudyrCensusSource(matrix)).toThrow();
  });
});
