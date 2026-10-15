// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { planNursingRecovery } from '../../../scripts/migration/planNursing.mjs';

const day = '2026-09-19';
const patient = (extra = {}) => ({
  patientName: 'Persona Ficticia',
  age: '45',
  rut: '12.345.678-5',
  clinicalEpisodeId: 'ep_local',
  admissionDate: '2026-09-18',
  admissionTime: '01:00',
  cudyr: { category: 'C2' },
  ...extra,
});
const record = (beds: Record<string, ReturnType<typeof patient>> = {}) => ({
  date: day,
  beds,
  discharges: [],
  importantValue: 'unchanged',
});
const fixture = () => ({
  source: { [day]: record({ R1: patient({ handoffNoteDayShift: 'PRIVATE_TEXT' }) }) },
  target: { [day]: record({ H1: patient() }) },
});

describe('nursing recovery planning', () => {
  it('plans only the original day-shift note and leaves both inputs and CUDYR intact', () => {
    const data = fixture(),
      before = structuredClone(data);
    const { patches, report } = planNursingRecovery(data);
    expect(patches).toEqual([
      {
        date: day,
        path: ['beds', 'H1', 'handoffNoteDayShift'],
        expectedValue: undefined,
        value: 'PRIVATE_TEXT',
      },
    ]);
    expect(report.cloudWrites).toBe(0);
    expect(report.authorizesMigration).toBe(false);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_TEXT|Persona|12345678|H1/);
    expect(data).toEqual(before);
  });
  it('preserves corrected admission time and plans independently of bed position', () => {
    const data = fixture();
    data.target[day].beds.H1.admissionTime = '04:00';
    expect(planNursingRecovery(data).patches).toHaveLength(1);
    expect(data.target[day].beds.H1.admissionTime).toBe('04:00');
  });
  it('never replaces a nonempty destination note', () => {
    const data = fixture();
    Object.assign(data.target[day].beds.H1, { handoffNoteDayShift: 'CORRECTED_TEXT' });
    const result = planNursingRecovery(data);
    expect(result.patches).toEqual([]);
    expect(result.report.cases[0].reason).toBe('preserve_destination_text');
  });
  it('is idempotent after the exact proposed field is present', () => {
    const data = fixture();
    Object.assign(data.target[day].beds.H1, { handoffNoteDayShift: 'PRIVATE_TEXT' });
    expect(planNursingRecovery(data).report.cases[0].status).toBe('already_equal');
  });
  it.each([
    { rut: '12.345.678-9' },
    { rut: '' },
    { patientName: 'RN de Persona', neonatalMaternalRut: '12.345.678-5' },
    { bedMode: 'Cuna' },
    { age: '2d' },
  ])('holds missing/invalid identity and neonatal cases: %j', extra => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, extra);
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('holds different or missing admission dates without a shared real episode', () => {
    for (const date of ['2026-09-19', '', undefined]) {
      const data = fixture();
      Object.assign(data.target[day].beds.H1, { admissionDate: date });
      expect(planNursingRecovery(data).patches).toEqual([]);
    }
    const data = fixture();
    Object.assign(data.source[day].beds.R1, { clinicalEpisodeId: 'real-episode-one' });
    Object.assign(data.target[day].beds.H1, {
      clinicalEpisodeId: 'real-episode-one',
      admissionDate: '2026-09-19',
    });
    expect(planNursingRecovery(data).patches).toHaveLength(1);
    expect(data.target[day].beds.H1.admissionDate).toBe('2026-09-19');
  });
  it.each(['5', '17a', '17 años', '', undefined, '11m', 'unknown'])(
    'holds children or unconfirmed age: %s',
    age => {
      const data = fixture();
      Object.assign(data.source[day].beds.R1, { age });
      expect(planNursingRecovery(data).patches).toEqual([]);
    }
  );
  it('checks adulthood on the census date using birth date when available', () => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, { birthDate: '2008-09-20', age: '45' });
    expect(planNursingRecovery(data).patches).toEqual([]);
    Object.assign(data.source[day].beds.R1, { birthDate: '2008-09-19' });
    expect(planNursingRecovery(data).patches).toHaveLength(1);
  });
  it.each(['not-a-date', '2026-02-30', '2026-09-20'])(
    'validates every target-only date: %s',
    key => {
      const data = fixture();
      Object.assign(data.target, { [key]: { ...record(), date: '2026-09-21' } });
      expect(() => planNursingRecovery(data)).toThrow('invalid_nursing_day');
    }
  );
  it('holds different real episodes, even with the same valid document', () => {
    const data = fixture();
    data.source[day].beds.R1.clinicalEpisodeId = 'real-episode-one';
    data.target[day].beds.H1.clinicalEpisodeId = 'real-episode-two';
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('holds multiple local source representations rather than guessing readmissions', () => {
    const data = fixture();
    Object.assign(data.source[day].beds, {
      R2: patient({ handoffNoteDayShift: 'PRIVATE_TEXT', admissionTime: '18:00' }),
    });
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('holds typed passports without converting their numbers into RUT', () => {
    const data = fixture();
    for (const p of [data.source[day].beds.R1, data.target[day].beds.H1])
      Object.assign(p, { documentType: 'Pasaporte', rut: 'SYN123456' });
    expect(planNursingRecovery(data).patches).toEqual([]);
    Object.assign(data.target[day].beds.H1, { documentType: 'RUT' });
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('holds target-only maternal document references and whitespace-prefixed local IDs', () => {
    const data = fixture();
    Object.assign(data.target[day].beds.H1, {
      clinicalCrib: { patientName: 'RN de Persona', neonatalMaternalRut: '12.345.678-5' },
    });
    expect(planNursingRecovery(data).patches).toEqual([]);
    delete (data.target[day].beds.H1 as { clinicalCrib?: object }).clinicalCrib;
    for (const id of [' ep_local ', ' legacy_ep_12 ', ' 0 ']) {
      data.source[day].beds.R1.clinicalEpisodeId = id;
      Object.assign(data.source[day].beds, {
        R2: patient({ clinicalEpisodeId: id, handoffNoteDayShift: 'PRIVATE_TEXT' }),
      });
      data.target[day].beds.H1.clinicalEpisodeId = id;
      expect(planNursingRecovery(data).patches).toEqual([]);
    }
  });
  it('uses neonatal shared-ID context from other supplied census days', () => {
    const data = fixture();
    Object.assign(data.target, {
      '2026-09-20': {
        date: '2026-09-20',
        beds: { R1: { patientName: 'RN de Persona', neonatalMaternalRut: '12.345.678-5' } },
      },
    });
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('retains incomplete RN records carrying only the maternal document', () => {
    const data = fixture();
    Object.assign(data.target[day].beds.H1, {
      clinicalCrib: { neonatalMaternalRut: '12.345.678-5' },
    });
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('holds maternal document reused by an RN even if the adult copy has a note', () => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, {
      clinicalCrib: { patientName: 'RN de Persona', neonatalMaternalRut: '12.345.678-5' },
    });
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('accepts consistent movement copies only with a common real episode', () => {
    const data = fixture();
    data.source[day].beds.R1.clinicalEpisodeId = 'real-episode-one';
    data.target[day].beds.H1.clinicalEpisodeId = 'real-episode-one';
    Object.assign(data.target[day], {
      discharges: [{ originalData: patient({ clinicalEpisodeId: 'real-episode-one' }) }],
    });
    expect(planNursingRecovery(data).patches).toHaveLength(2);
    Object.assign(data.source[day], {
      discharges: [
        {
          originalData: patient({
            clinicalEpisodeId: 'real-episode-one',
            handoffNoteDayShift: 'CONFLICTING_TEXT',
          }),
        },
      ],
    });
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('never moves nursing text to a different census day or shift', () => {
    const data = fixture();
    Object.assign(data.source[day].beds.R1, { handoffNoteNightShift: 'NIGHT_PRIVATE' });
    const result = planNursingRecovery(data);
    expect(result.patches.map(p => p.path.at(-1))).toEqual([
      'handoffNoteDayShift',
      'handoffNoteNightShift',
    ]);
    const next = '2026-09-20';
    Object.assign(data.target, { [next]: { ...data.target[day], date: next } });
    Reflect.deleteProperty(data.target, day);
    expect(planNursingRecovery(data).patches).toEqual([]);
  });
  it('rejects mismatched day metadata', () => {
    const data = fixture();
    data.target[day].date = '2026-09-20';
    expect(() => planNursingRecovery(data)).toThrow('invalid_nursing_day');
  });
  it('CLI prints only the redacted report and refuses mutation flags', () => {
    const result = spawnSync(process.execPath, ['scripts/migration/planNursing.mjs'], {
      input: JSON.stringify(fixture()),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/PRIVATE_TEXT|Persona|12345678/);
    expect(JSON.parse(result.stdout).plannedFields).toBe(1);
    const invalid = spawnSync(process.execPath, ['scripts/migration/planNursing.mjs', '--apply'], {
      input: JSON.stringify(fixture()),
      encoding: 'utf8',
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toBe('');
  });
});
