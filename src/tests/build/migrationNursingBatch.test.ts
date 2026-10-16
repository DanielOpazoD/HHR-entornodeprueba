// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { selectNursingRootBatch } from '../../../scripts/migration/planNursing.mjs';

const day = '2026-09-19';
const patient = (extra = {}) => ({
  patientName: 'Ana Cecilia Perez Soto',
  rut: '12.345.678-5',
  age: '45',
  birthDate: '1981-01-01',
  admissionDate: '2026-09-18',
  clinicalEpisodeId: 'ep_local_only',
  cudyr: { category: 'C2' },
  ...extra,
});
const record = (date = day, beds: Record<string, ReturnType<typeof patient>> = {}) => ({
  date,
  beds,
  discharges: [],
  transfers: [],
  cma: [],
});
const fixture = () => ({
  dates: [day],
  throughDate: '2026-10-15',
  source: {
    [day]: record(day, {
      R1: patient({
        handoffNoteDayShift: 'ORIGINAL_PRIVATE_NOTE',
        handoffNoteNightShift: 'NIGHT_PRIVATE_NOTE',
      }),
    }),
  },
  target: { [day]: record(day, { H1C1: patient({ admissionTime: '04:15' }) }) },
});

describe('bounded adult nursing selection', () => {
  it('selects same-patient notes independently of bed or corrected admission time without mutating inputs', () => {
    const data = fixture(),
      before = structuredClone(data);
    const result = selectNursingRootBatch(data);
    expect(result.patches).toHaveLength(2);
    expect(result.patches[0].path).toEqual(['beds', 'H1C1', 'handoffNoteDayShift']);
    expect(result.report.days).toEqual([{ date: day, patients: 1, noteFields: 2 }]);
    expect(result.report.identityEvidenceKinds).toEqual({ exact_name: 2 });
    expect(result.report.cloudWrites).toBe(0);
    expect(result.report.authorizesMigration).toBe(false);
    expect(data).toEqual(before);
    expect(JSON.stringify(result.report)).not.toMatch(
      /ORIGINAL_PRIVATE_NOTE|NIGHT_PRIVATE_NOTE|Ana|12345678|H1C1/
    );
  });

  it.each(['Ana Cecilia Pérez-Soto', 'Ana Cecilia Perez Soto *'])(
    'accepts punctuation differences only with the same verified document, birth and admission',
    name => {
      const data = fixture();
      data.source[day].beds.R1.patientName = name;
      expect(selectNursingRootBatch(data).report.identityEvidenceKinds).toEqual({
        punctuation_only: 2,
      });
    }
  );

  it('accepts an ordered extension of a full name, with three meaningful tokens on both sides', () => {
    const data = fixture();
    data.source[day].beds.R1.patientName = 'Ana Perez Soto';
    expect(selectNursingRootBatch(data).report.identityEvidenceKinds).toEqual({
      ordered_name_extension: 2,
    });
  });

  it.each(['Ana C Perez', 'Ana C Perez Soto'])(
    'holds initials even when the first token agrees and the shorter name is an ordered subset',
    name => {
      const data = fixture();
      data.source[day].beds.R1.patientName = 'Ana C Perez';
      data.target[day].beds.H1C1.patientName = name;
      expect(selectNursingRootBatch(data).patches).toEqual([]);
    }
  );

  it.each([
    'Ana Soto',
    'Cecilia Perez Soto',
    'Soto Perez Ana',
    'Ana Maria Perez Soto',
    'Ana de la',
    'A C Perez Soto',
    'Different Person Entirely',
  ])('holds incomplete, reordered, contradictory and fuzzy names: %s', name => {
    const data = fixture();
    data.source[day].beds.R1.patientName = name;
    expect(selectNursingRootBatch(data).patches).toEqual([]);
  });

  it.each([
    { birthDate: '' },
    { birthDate: '1980-01-01' },
    { admissionDate: '2026-09-17' },
    { clinicalEpisodeId: 'real-old-episode' },
    { rut: '12.345.678-9' },
  ])('holds missing or contradictory identity/episode evidence: %j', extra => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, extra);
    Object.assign(data.target[day].beds.H1C1, { clinicalEpisodeId: 'real-new-episode' });
    expect(selectNursingRootBatch(data).patches).toEqual([]);
  });

  it('does not let a shared real episode bypass the equal-admission requirement for this lane', () => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, {
      clinicalEpisodeId: 'shared-real',
      admissionDate: '2026-09-17',
    });
    Object.assign(data.target[day].beds.H1C1, { clinicalEpisodeId: 'shared-real' });
    expect(selectNursingRootBatch(data).report.excludedFields).toEqual({
      additional_identity_or_episode_evidence: 2,
    });
  });

  it('preserves existing destination notes and produces no work after the selected notes are applied', () => {
    const data = fixture();
    Object.assign(data.target[day].beds.H1C1, { handoffNoteDayShift: 'CORRECTED_NOTE' });
    const result = selectNursingRootBatch(data);
    expect(result.patches).toHaveLength(1);
    Object.assign(data.target[day].beds.H1C1, { handoffNoteNightShift: 'NIGHT_PRIVATE_NOTE' });
    expect(selectNursingRootBatch(data).patches).toEqual([]);
  });

  it('holds root copies duplicated in movements, even with a shared episode', () => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, { clinicalEpisodeId: 'shared-real' });
    Object.assign(data.target[day].beds.H1C1, { clinicalEpisodeId: 'shared-real' });
    Object.assign(data.source[day], { discharges: [{ originalData: data.source[day].beds.R1 }] });
    expect(selectNursingRootBatch(data).patches).toEqual([]);
  });

  it('does not select a mother with a linked crib', () => {
    const data = fixture();
    Object.assign(data.target[day].beds.H1C1, { clinicalCrib: {} });
    expect(selectNursingRootBatch(data).patches).toEqual([]);
  });

  it('permits an unrelated adult on a day with an RN, but leaves the RN untouched', () => {
    const data = fixture();
    Object.assign(data.source[day].beds, {
      'C-R3': {
        patientName: 'RN de Otra Persona',
        rut: '11.111.111-1',
        age: '2d',
        handoffNoteDayShift: 'RN_NOTE',
      },
    });
    expect(selectNursingRootBatch(data).patches).toHaveLength(2);
    expect(JSON.stringify(selectNursingRootBatch(data).patches)).not.toContain('RN_NOTE');
  });

  it('retains the neonatal identity guard across the entire supplied context', () => {
    const data = fixture();
    Object.assign(data.source, {
      '2026-09-20': record('2026-09-20', {
        RN: patient({
          patientName: 'RN de Persona',
          age: '2d',
          neonatalMaternalRut: '12.345.678-5',
        }),
      }),
    });
    expect(selectNursingRootBatch(data).patches).toEqual([]);
  });

  it.each([
    { dates: [] },
    { dates: [day, day] },
    { dates: [day, '2026-09-20', '2026-09-21', '2026-09-22'] },
    { dates: ['2026-06-30'] },
    { dates: ['2026-10-16'] },
    { throughDate: 'invalid' },
  ])('rejects dates outside the explicitly bounded scope: %j', extra => {
    expect(() => selectNursingRootBatch({ ...fixture(), ...extra })).toThrow(
      'invalid_nursing_batch_scope'
    );
  });

  it('caps a day at four patients/eight fields while leaving other candidates visible as held', () => {
    const data = fixture();
    const identifiers = [
      '12.345.678-5',
      '11.111.111-1',
      '22.222.222-2',
      '9.876.543-3',
      '7.654.321-6',
    ];
    identifiers.forEach((rut, index) => {
      data.source[day].beds['R' + index] = patient({
        rut,
        handoffNoteDayShift: 'DAY',
        handoffNoteNightShift: 'NIGHT',
      });
      data.target[day].beds['H' + index] = patient({ rut });
    });
    // Remove the initial duplicate identity/representation used by the single-person fixture.
    delete data.source[day].beds.R1;
    Object.assign(data.source[day].beds, {
      R1: patient({
        rut: identifiers[1],
        handoffNoteDayShift: 'DAY',
        handoffNoteNightShift: 'NIGHT',
      }),
    });
    delete data.target[day].beds.H1C1;
    const result = selectNursingRootBatch(data);
    expect(result.report.selectedFields).toBe(8);
    expect(result.report.days[0].patients).toBe(4);
    expect(result.report.excludedFields).toMatchObject({ batch_budget: 2 });
  });

  it('selects the same bounded batch when Firestore object insertion order changes', () => {
    const data = fixture();
    data.source[day].beds = {};
    data.target[day].beds = {};
    const identifiers = [
      '12.345.678-5',
      '11.111.111-1',
      '22.222.222-2',
      '9.876.543-3',
      '7.654.321-6',
    ];
    identifiers.forEach((rut, index) => {
      data.source[day].beds['R' + index] = patient({ rut, handoffNoteDayShift: 'DAY' });
      data.target[day].beds['H' + index] = patient({ rut });
    });
    const before = selectNursingRootBatch(data).report.selectionFingerprints;
    data.source[day].beds = Object.fromEntries(Object.entries(data.source[day].beds).reverse());
    data.target[day].beds = Object.fromEntries(Object.entries(data.target[day].beds).reverse());
    expect(selectNursingRootBatch(data).report.selectionFingerprints).toEqual(before);
  });

  it('CLI prints only the redacted selection and refuses mutation flags', () => {
    const run = spawnSync(process.execPath, ['scripts/migration/selectNursingBatch.mjs'], {
      encoding: 'utf8',
      input: JSON.stringify(fixture()),
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).selectedFields).toBe(2);
    expect(run.stdout).not.toMatch(/PRIVATE_NOTE|Ana|H1C1/);
    const denied = spawnSync(
      process.execPath,
      ['scripts/migration/selectNursingBatch.mjs', '--apply'],
      { encoding: 'utf8' }
    );
    expect(denied.status).toBe(1);
    expect(denied.stdout).toBe('');
  });
});
