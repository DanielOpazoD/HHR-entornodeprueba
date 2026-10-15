import { exportSheet, row, source } from './cudyrSourceTable.fixtures';
import { CUDYR_EXCLUSION_LABELS, type CudyrExclusionReason } from '@/types/domain/cudyrExclusion';
import { describe, expect, it, vi } from 'vitest';
import { validateCudyrSourceSheet } from '@/services/cudyr/cudyrSourceValidation';

vi.mock('@/services/cudyr/cudyrSupplementService', () => ({}));
const boundaryCase = () => {
  const current = source();
  current.matrix.rows = current.matrix.rows.slice(0, 4);
  current.matrix.rows[3][9] = '';
  const r = row();
  r.rut = 'DOC';
  r.patientName = 'Paciente Sintético';
  r.date = '2026-10-01';
  r.monthlyEvidence = undefined;
  r.hospitalAdmissionAt = '2026-09-29T15:35:00Z';
  r.resolvedSystemDeparture = true;
  r.movements[0].date = '2026-10-01';
  r.correction = undefined;
  return { r, current };
};

describe('readable source table and documentary movement annotations', () => {
  it('recovers day-1 admission from the preceding stay with a confirmed departure and exact full identity', async () => {
    const { r, current } = boundaryCase();
    const rn = {
      ...r,
      patientName: 'RN de Paciente Sintético',
      clinicalEpisodeId: 'newborn',
      hospitalAdmissionAt: '2026-09-30T06:18:00Z',
    };
    const sheet = await exportSheet([r, rn], current);
    expect(sheet.getCell('F2').value).toEqual(new Date('2026-09-29T00:00:00Z'));
    expect(sheet.getCell('F2').note).toContain('Cruce de mes');
    expect(sheet.getCell('I2').text).toBe('▲ C2');
  });
  it.each([
    'name',
    'document',
    'episode',
    'later_day',
    'unconfirmed_exit',
    'other_exit',
    'admission_conflict',
    'duplicate_source',
  ])('keeps boundary admission unavailable with %s ambiguity', async issue => {
    const { r, current } = boundaryCase();
    const rows = [r];
    if (issue === 'name') r.patientName = 'Otra Persona';
    if (issue === 'document') r.rut = 'OTHER';
    if (issue === 'episode') rows.push({ ...r, clinicalEpisodeId: 'second' });
    if (issue === 'later_day') current.matrix.rows[3][9] = 'C2';
    if (issue === 'unconfirmed_exit') r.movements[0].source = 'unknown';
    if (issue === 'other_exit') r.movements.push({ ...r.movements[0], date: '2026-10-02' });
    if (issue === 'admission_conflict') r.admissionEvidenceConflict = true;
    if (issue === 'duplicate_source')
      current.matrix.rows.push([
        2,
        'Paciente Sintético',
        'FICHA',
        'DOC',
        'Otro episodio',
        1,
        'MQ',
        'Vivo',
        'C2',
      ]);
    const sheet = await exportSheet(rows, current);
    expect(sheet.getCell('F2').value).toBe('No informado');
    expect(sheet.getCell('I2').text).toBe('C2');
  });
  it('recognizes UTC and local offsets as the same admission instant across a date boundary', async () => {
    const first = { ...row(), hospitalAdmissionAt: '2026-10-02T03:46:00.000Z' };
    const same = { ...first, hospitalAdmissionAt: '2026-10-01T22:46:00-05:00' };
    const sheet = await exportSheet([first, same]);
    expect(sheet.getCell('F2').value).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(sheet.getCell('F2').note).toContain('01-10-2026 22:46');
    expect(sheet.getCell('I2').text).toBe('▼ C2');
  });
  it('does not hide a genuinely different admission behind the same calendar date', async () => {
    const first = row();
    const different = { ...first, hospitalAdmissionAt: '2026-10-01T07:47:00Z' };
    const sheet = await exportSheet([first, different]);
    expect(sheet.getCell('F2').value).toBe('No informado');
  });
  it('rejects ambiguous timezone-less admission evidence alongside a valid instant', async () => {
    const first = row();
    const invalid = { ...first, hospitalAdmissionAt: '2026-10-01T01:47:00' };
    const sheet = await exportSheet([first, invalid]);
    expect(sheet.getCell('F2').value).toBe('No informado');
  });
  it('keeps one frozen header, joins page continuations and retains separate episodes of the same person', async () => {
    const sheet = await exportSheet();
    expect(sheet.getRow(1).values).not.toContain('Ficha Clínica');
    expect(sheet.getRow(1).values).not.toContain('Días Hosp.');
    expect(sheet.getCell('F1').value).toBe('Fecha de ingreso');
    expect(sheet.getCell('F2').value).toBe('No informado');
    expect(sheet.getCell('A4').value).toBe('Octubre 2026');
    expect(sheet.getCell('B1').value).toBe('Nombre Paciente');
    expect(sheet.getCell('B2').value).toBe('Paciente Sintético Apellido');
    expect(sheet.getCell('E2').value).toBe('Diagnóstico continuado');
    expect(sheet.getCell('B3').value).toBe('Paciente Sintético');
    expect(sheet.getCell('E3').value).toBe('Otro episodio');
    expect(sheet.getCell('I2').value).toBe('C2');
    expect(sheet.getCell('J2').value).toBe('S/C');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 4, ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:AM3');
    expect(sheet.pageSetup.printTitlesRow).toBe('1:1');
    expect(sheet.getColumn(9).width).toBeGreaterThanOrEqual(10);
  });
  it('annotates real calendar dates in Rapa Nui, leaving categories and re-admissions intact', async () => {
    const sheet = await exportSheet([row()]);
    expect(sheet.getCell('F2').value).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(sheet.getCell('F2').numFmt).toBe('dd-mm-yyyy');
    expect(sheet.getColumn(6).width).toBeLessThanOrEqual(20);
    expect(sheet.getCell('F3').value).toBe('No informado');
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('I2').note).toContain('01-10-2026 01:47');
    expect(sheet.getCell('J2').text).toBe('▲ S/C');
    expect(sheet.getCell('J2').note).toContain('02-10-2026 01:47');
    expect(sheet.getCell('J2').note).not.toContain('03-10-2026');
    expect(sheet.getCell('J3').value).toBe('D3');
    expect(sheet.getCell('I2').value).toMatchObject({
      richText: [{ font: { color: { argb: 'FF047857' } } }, { text: 'C2' }],
    });
  });
  it('marks confirmed external transfers as departures', async () => {
    const r = row();
    r.movements[0].section = 'transfers';
    const sheet = await exportSheet([r]);
    expect(sheet.getCell('J2').text).toBe('▲ S/C');
    expect(sheet.getCell('J2').note).toContain('02-10-2026 01:47');
  });
  it('shows both symbols for a same-day stay, including a blank original category', async () => {
    const r = row();
    r.hospitalAdmissionAt = '2026-10-02T05:30:00Z';
    const s = source();
    s.matrix.rows[3][9] = '';
    const sheet = await exportSheet([r], s);
    expect(sheet.getCell('J2').text).toBe('▼ ▲ ');
    expect(sheet.getCell('J2').note).toContain('(vacío)');
  });
  it.each(['missing-link', 'wrong-source', 'conflicting-link', 'two-episodes', 'two-source-rows'])(
    'does not infer movements for %s',
    async reason => {
      const r = row();
      const rows = [r];
      if (reason === 'missing-link') delete r.monthlyEvidence;
      if (reason === 'wrong-source') r.monthlyEvidence!.reportId = 'other';
      if (reason === 'conflicting-link') r.monthlyEvidence!.state = 'conflict';
      if (reason === 'two-episodes') rows.push({ ...r, clinicalEpisodeId: 'other' });
      if (reason === 'two-source-rows')
        rows.push({ ...r, monthlyEvidence: { ...r.monthlyEvidence!, sourceRow: 8 } });
      const sheet = await exportSheet(rows);
      expect(sheet.getCell('F2').value).toBe('No informado');
      expect(sheet.getCell('I2').value).toBe('C2');
      expect(sheet.getCell('J2').value).toBe('S/C');
    }
  );
  it('omits inconsistent admission dates and ambiguous departures', async () => {
    const r = row();
    const other = {
      ...r,
      hospitalAdmissionAt: '2026-10-02T09:00:00Z',
      movements: [{ ...r.movements[0], date: '2026-10-03' }],
    };
    const sheet = await exportSheet([r, other]);
    expect(sheet.getCell('I2').value).toBe('C2');
    expect(sheet.getCell('J2').value).toBe('S/C');
  });
  it('does not use unproven discharge sources or admission conflicts', async () => {
    const r = row();
    r.admissionEvidenceConflict = true;
    r.movements[0].source = 'HHR · procedencia no documentada';
    const sheet = await exportSheet([r]);
    expect(sheet.getCell('I2').value).toBe('C2');
    expect(sheet.getCell('J2').value).toBe('S/C');
  });
  it('uses the latest verified discharge correction and does not invent a missing hour', async () => {
    const r = row();
    r.correction = {
      schemaVersion: 1,
      clinicalEpisodeId: 'episode',
      revision: 2,
      operationId: 'synthetic',
      actualDischarge: { date: '2026-10-03', timeZone: 'Pacific/Easter' },
      reason: 'Verified synthetic correction',
      authorityDate: '2026-10-03',
      admissionDate: '2026-10-01',
      sourceContexts: [],
      updatedAt: '2026-10-04T12:00:00Z',
      updatedBy: { uid: 'test', email: '', name: 'Test', role: 'admin' },
    };
    const old = {
      ...r,
      correction: {
        ...r.correction,
        revision: 1,
        actualDischarge: { date: '2026-10-02', timeZone: 'Pacific/Easter' as const },
      },
    };
    const sheet = await exportSheet([r, old]);
    expect(sheet.getCell('J2').value).toBe('S/C');
    expect(sheet.getCell('K2').text).toBe('▲ ');
    expect(sheet.getCell('K2').note).toContain('03-10-2026 · hora no informada');
  });
  it.each(['cma', 'uea', 'cuna'] as const)(
    'retains and highlights excluded %s episodes without marking another episode of the person',
    async modality => {
      const r = row();
      r.eligibility = 'no_elegible';
      r.modality = modality;
      const second = {
        ...r,
        date: '2026-10-01',
        monthlyEvidence: { ...r.monthlyEvidence!, sourceDate: '2026-10-02' },
      };
      const sheet = await exportSheet([r, second]);
      expect(sheet.getCell('B3').value).toBe('Paciente Sintético');
      expect(sheet.getCell('E3').value).toBe('Otro episodio');
      expect(sheet.getCell('J3').value).toBe('D3');
      expect(sheet.getCell('I2').text).toBe('▼ C2');
      expect(sheet.getCell('J2').text).toBe('▲ S/C');
      expect(sheet.getCell('D2').text).toMatch(/^Excluido: /);
      expect(sheet.getCell('D2').text).toContain(
        modality === 'cma' ? 'CMA' : modality === 'uea' ? 'Urgencias / UEA' : 'Cuna RN sano'
      );
      expect(sheet.getCell('B2').fill).toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
      expect(sheet.getCell('D3').value).toBeNull();
      expect(sheet.getCell('B3').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
      expect(sheet.autoFilter).toBe('A1:AM3');
    }
  );
  it('highlights only excluded dates of a mixed episode while retaining categories and movements', async () => {
    const excluded = row();
    excluded.eligibility = 'no_elegible';
    excluded.date = '2026-09-30';
    const eligible = {
      ...excluded,
      date: '2026-10-01',
      eligibility: 'elegible' as const,
      monthlyEvidence: { ...excluded.monthlyEvidence!, sourceDate: '2026-10-02' },
    };
    const sheet = await exportSheet([excluded, eligible]);
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('I2').fill).toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
    expect(sheet.getCell('I2').note).toContain('Aplicación 01-10-2026 → turno noche 30-09-2026');
    expect(sheet.getCell('D2').text).toMatch(/^Exclusión parcial: /);
    expect(sheet.getCell('B2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
    expect(sheet.getCell('J2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
    expect(sheet.getCell('J2').text).toBe('▲ S/C');
    expect(sheet.getCell('F2').numFmt).toBe('dd-mm-yyyy');
    expect(sheet.getCell('A1').note).toContain('exclusiones confirmadas');
  });
  it('does not infer exclusions when the source day is unlinked or decisions conflict', async () => {
    const excluded = row();
    excluded.eligibility = 'no_elegible';
    const eligible = { ...excluded, eligibility: 'elegible' as const };
    const sheet = await exportSheet([excluded, eligible]);
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('J2').text).toBe('▲ S/C');
    expect(sheet.getCell('D2').value).toBeNull();
    expect(sheet.getCell('D3').value).toBeNull();
    expect(sheet.getCell('I2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
  });
  it.each(['missing-episode', 'conflicting-source', 'different-episode'])(
    'does not label ambiguous excluded evidence: %s',
    async scenario => {
      const r = row();
      r.eligibility = 'no_elegible';
      if (scenario === 'missing-episode') r.clinicalEpisodeId = '';
      if (scenario === 'conflicting-source') r.monthlyEvidence!.state = 'conflict';
      const other = { ...r, clinicalEpisodeId: 'another-episode' };
      const sheet = await exportSheet(scenario === 'different-episode' ? [r, other] : [r]);
      expect(sheet.getCell('D2').value).toBeNull();
      expect(sheet.getCell('I2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
      expect(sheet.getCell('E3').value).toBe('Otro episodio');
    }
  );
  it('retains excluded next-month day 1 without using later-day eligibility', async () => {
    const excluded = row();
    excluded.eligibility = 'no_elegible';
    excluded.date = '2026-09-30';
    const eligible = {
      ...excluded,
      eligibility: 'elegible' as const,
      monthlyEvidence: { ...excluded.monthlyEvidence!, sourceDate: '2026-10-02' },
    };
    const sheet = await exportSheet([excluded, eligible], source(), '2026-09');
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('D2').text).toMatch(/^Excluido: /);
    expect(sheet.getCell('A3').value).toBe('Día incluido: 01-10-2026');
    expect(sheet.autoFilter).toBe('A1:I2');
  });
  it('does not color the day after a resolved discharge or call it an exclusion', async () => {
    const r = row();
    r.date = '2026-10-01';
    r.eligibility = 'no_elegible';
    r.resolvedSystemDeparture = true;
    r.monthlyEvidence!.sourceDate = '2026-10-02';
    r.movements[0].date = '2026-10-01';
    const sheet = await exportSheet([r]);
    expect(sheet.getCell('I2').text).toBe('▼ ▲ C2');
    expect(sheet.getCell('J2').text).toBe('S/C');
    expect(sheet.getCell('J2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
    expect(sheet.getCell('D2').value).toBeNull();
  });
  it('explains short-stay exclusion without coloring an empty application cell', async () => {
    const current = source();
    current.matrix.rows[3][8] = '';
    const r = row();
    r.eligibility = 'no_elegible';
    r.eligibilityReason = 'Hospitalización menor de 8 horas al corte.';
    const sheet = await exportSheet([r], current);
    expect(sheet.getCell('D2').text).toContain('Hospitalización < 8 horas');
    expect(sheet.getCell('I2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
    expect(sheet.getCell('I2').note).toContain('turno noche 30-09-2026');
  });
  it('does not apply a census-day exclusion to a mismatched application date', async () => {
    const r = row();
    r.date = '2026-10-01';
    r.eligibility = 'no_elegible';
    const sheet = await exportSheet([r]);
    expect(sheet.getCell('D2').value).toBeNull();
  });
  it.each(['cma', 'uea'] as const)(
    'shows the documented %s episode admission when hospital admission is absent',
    async modality => {
      const r = row();
      r.hospitalAdmissionAt = '';
      r.modality = modality;
      r.admissionDate = '2026-09-29';
      r.admissionTime = '17:43';
      const sheet = await exportSheet([r]);
      expect(sheet.getCell('F2').value).toEqual(new Date('2026-09-29T00:00:00Z'));
      expect(sheet.getCell('F2').note).toContain('Ingreso del episodio CMA/UEA');
      expect(sheet.getCell('F2').note).toContain('17:43');
    }
  );
  it('keeps the real early-morning CMA admission date on the previous night census', async () => {
    const r = row();
    r.modality = 'cma';
    r.hospitalAdmissionAt = '';
    r.admissionDate = '2026-10-01';
    r.admissionTime = '01:47';
    const sheet = await exportSheet([r]);
    expect(sheet.getCell('F2').value).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(sheet.getCell('I2').text).toBe('▼ C2');
  });
  it.each(['hospitalizacion', 'conflict', 'dates', 'invalid', 'future', 'times'])(
    'does not invent episode admission for %s',
    async scenario => {
      const r = row();
      r.hospitalAdmissionAt = '';
      r.modality = 'cma';
      r.admissionDate = '2026-09-29';
      r.admissionTime = '17:43';
      const other = { ...r };
      if (scenario === 'hospitalizacion') r.modality = 'hospitalizacion';
      if (scenario === 'conflict') r.admissionEvidenceConflict = true;
      if (scenario === 'dates') other.admissionDate = '2026-09-28';
      if (scenario === 'invalid') r.admissionDate = other.admissionDate = '2026-02-30';
      if (scenario === 'future') r.admissionDate = other.admissionDate = '2026-10-02';
      if (scenario === 'times') other.admissionTime = '18:43';
      const sheet = await exportSheet([r, other]);
      expect(sheet.getCell('F2').value).toBe('No informado');
    }
  );
  it('keeps only day 1 in the following month, without leaking later movement markers', async () => {
    const sheet = await exportSheet([row()], source(), '2026-09');
    expect(sheet.columnCount).toBe(9);
    expect(sheet.getCell('I2').text).toBe('▼ C2');
    expect(sheet.getCell('I3').value).toBeNull();
    expect(sheet.autoFilter).toBe('A1:I2');
  });
});

describe('source preservation before download', () => {
  it.each(['category', 'identity', 'missing episode', 'extra episode', 'day heading'])(
    'rejects a changed %s without exposing patient data in the error',
    async change => {
      const current = source();
      const sheet = await exportSheet([row()], current);
      expect(() => validateCudyrSourceSheet(sheet, current, false)).not.toThrow();
      if (change === 'category') sheet.getCell('I2').value = 'A1';
      if (change === 'identity') sheet.getCell('B2').value = 'Otra identidad';
      if (change === 'missing episode') sheet.spliceRows(3, 1);
      if (change === 'extra episode') sheet.addRow(['Otro episodio']);
      if (change === 'day heading') sheet.getCell('I1').value = 'Día 2';
      expect(() => validateCudyrSourceSheet(sheet, current, false)).toThrow(
        'El Excel no conserva todos los episodios y valores de Eloísa.'
      );
    }
  );
  it('rejects later-month leakage into the day-1 excerpt', async () => {
    const current = source();
    const sheet = await exportSheet([row()], current, '2026-09');
    expect(() => validateCudyrSourceSheet(sheet, current, true)).not.toThrow();
    sheet.getCell('J1').value = 'Día 2';
    expect(() => validateCudyrSourceSheet(sheet, current, true)).toThrow('no conserva');
  });
});

describe('saved manual exclusion labels', () => {
  it.each(Object.keys(CUDYR_EXCLUSION_LABELS) as CudyrExclusionReason[])(
    'preserves the selected %s reason for its day without excluding the whole episode',
    async reason => {
      const excluded = row();
      excluded.eligibility = 'no_elegible';
      excluded.exclusion = {
        id: 'synthetic-exclusion',
        date: excluded.date,
        clinicalEpisodeId: excluded.clinicalEpisodeId,
        reason,
        note: 'Situación confirmada en el turno sintético.',
        source: 'manual',
        revision: 1,
        operationId: 'synthetic-operation',
        updatedAt: '2026-10-03T18:00:00Z',
        updatedBy: { uid: 'synthetic', name: 'Revisor sintético', email: '', role: 'admin' },
      };
      const eligible = {
        ...excluded,
        date: '2026-10-01',
        eligibility: 'elegible' as const,
        exclusion: undefined,
        monthlyEvidence: { ...excluded.monthlyEvidence!, sourceDate: '2026-10-02' },
      };
      const sheet = await exportSheet([excluded, eligible]);
      expect(sheet.getCell('D2').text).toBe(`Exclusión parcial: ${CUDYR_EXCLUSION_LABELS[reason]}`);
      expect(sheet.getCell('D2').note).toContain(CUDYR_EXCLUSION_LABELS[reason]);
      expect(sheet.getCell('I2').note).toContain(CUDYR_EXCLUSION_LABELS[reason]);
      expect(sheet.getCell('J2').fill).not.toMatchObject({ fgColor: { argb: 'FFFFF4DC' } });
      expect(sheet.getCell('D3').value).toBeNull();
      // A withdrawn manual decision must fall back to the automatic reason.
      excluded.exclusion.reason = null;
      excluded.modality = 'cuna';
      const withdrawn = await exportSheet([excluded, eligible]);
      expect(withdrawn.getCell('D2').text).toBe('Exclusión parcial: Cuna RN sano');
    }
  );
});
