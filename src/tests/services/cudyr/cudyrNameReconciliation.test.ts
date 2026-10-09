import { describe, expect, it } from 'vitest';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { verifyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyVerification';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput, reportRecord, reportPatient } from './reportFixtures';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';

const fixture = (
  first = 'Ana',
  last = 'Prueba',
  second = 'Ejemplo',
  sourceName = 'Ana Urgencias Prueba Ejemplo'
) => {
  const name = [first, last, second].filter(Boolean).join(' ');
  const data = buildCudyrReport(
    confirmedReportInput({
      records: [
        reportRecord('2026-10-02', {
          R1: reportPatient({
            patientName: name,
            firstName: first,
            lastName: last,
            secondLastName: second,
          }),
        }),
      ],
    })
  );
  data.generatedAt = '2026-11-02T20:00:00Z';
  data.rows[0].evaluation = null;
  data.rows[0].cudyrStatus = 'sin_captura';
  const report = supplementRequest().report;
  report.patients = [
    {
      ...report.patients[0],
      patientName: sourceName,
      document: data.rows[0].rut,
      days: report.patients[0].days.map(d => ({
        ...d,
        category: d.sourceDay === 3 ? 'C2' : null,
        originalValue: d.sourceDay === 3 ? 'C2' : '',
        state: d.sourceDay === 3 ? 'category' : 'blank',
      })),
    },
  ];
  const source = {
    id: 'source',
    month: '2026-10',
    report,
    bytesVerified: true,
    importedAt: '2026-11-02T19:00:00Z',
    capture: { source: 'extension_monthly_report', observedAt: '2026-11-02T18:00:00Z' },
  } as ArchivedCudyrSupplement;
  return { data, report, source };
};

describe('census-supported CUDYR name reconciliation', () => {
  it.each([
    ['Ana', 'Prueba', 'Ejemplo', 'ANA Urgencias PRUEBA EJEMPLO'],
    ['Anamaria', 'Prueba', 'Ejemplo', 'Ana Maria Prueba Ejemplo'],
    ['Ana Maria', 'Prueba', '', 'Anamaria Prueba *'],
    ['Ana', 'Prueba', '', 'Ana Prueba Noinformado'],
    ['Ana', 'Prueba', '', 'Ana Prueba No Informado'],
    ['Ana', 'Prueba', '', 'Ana Prueba Sin Información'],
    ['Ana Maria', 'Prueba', 'Ejemplo', 'PRUEBA EJEMPLO ANA MARIA'],
    ['Ana', 'Prueba', '', 'PRUEBA NOINFORMADO ANA'],
    ['Ana', 'Prueba', '', 'PRUEBA NO INFORMADO ANA'],
  ])(
    'links known formatting variants without changing census identity: %s %s %s',
    (first, last, second, name) => {
      const { data, source } = fixture(first, last, second, name);
      const before = JSON.stringify(data);
      const output = applyCudyrMonthlySources(data, [source]);
      expect(output.rows).toHaveLength(1);
      expect(output.rows[0]).toMatchObject({
        patientName: data.rows[0].patientName,
        clinicalEpisodeId: data.rows[0].clinicalEpisodeId,
        eligibility: data.rows[0].eligibility,
        monthlyEvidence: {
          identityMatch: 'census_name_normalization',
          sourcePatientName: name,
          state: 'found',
        },
        evaluation: { category: 'C2' },
      });
      expect(
        verifyCudyrMonthlySources(output, [source])
          .checks.filter(c => c.state === 'found')
          .every(c => !c.needsReview)
      ).toBe(true);
      expect(JSON.stringify(data)).toBe(before);
    }
  );
  it.each([
    ['Anamaria', 'Prueba', 'Ejemplo', 'Ana Mario Prueba Ejemplo'],
    ['Ana', 'Sapu', 'Ejemplo', 'Ana Ejemplo'],
    ['Ana', 'Prueba', 'Ejemplo', 'Ana Prueba'],
    ['Ana Maria', 'Prueba', 'Ejemplo', 'Maria Ana Prueba Ejemplo'],
    ['Ana', 'Prueba', 'Ejemplo', 'Ana Ejemplo Prueba'],
    ['Ana', 'Prueba', 'Ejemplo', 'RN DE Ana Prueba Ejemplo'],
    ['Ana', 'Prueba', 'Ejemplo', 'Ana Urgencio Prueba Ejemplo'],
  ])('does not approximate identity: %s %s %s / %s', (first, last, second, name) => {
    const { data, source } = fixture(first, last, second, name);
    const output = applyCudyrMonthlySources(data, [source]);
    expect(output.rows.find(r => r.key === data.rows[0].key)?.evaluation).toBeNull();
    expect(output.rows.find(r => r.contextSource === 'eloisa_monthly_report')?.eligibility).toBe(
      'por_revisar'
    );
  });
  it.each([
    'different document',
    'empty document',
    'shared newborn',
    'conflicting source name',
    'missing episode',
    'inconsistent structured name',
    'another inconsistent census row',
    'another surname partition',
  ])('refuses unsafe alias: %s', kind => {
    const { data, report, source } = fixture();
    if (kind === 'different document') report.patients[0].document = 'different';
    if (kind === 'empty document') {
      report.patients[0].document = '';
      data.rows[0].rut = '';
    }
    if (kind === 'shared newborn')
      data.rows.push({
        ...data.rows[0],
        key: 'rn',
        patientName: 'RN DE Ana Prueba Ejemplo',
        clinicalEpisodeId: 'rn',
      });
    if (kind === 'conflicting source name')
      report.patients.push({
        ...report.patients[0],
        sourceRow: 999,
        patientName: 'Otra Persona Ejemplo',
      });
    if (kind === 'missing episode') data.rows[0].clinicalEpisodeId = '';
    if (kind === 'inconsistent structured name') data.rows[0].firstName = 'Otra';
    if (kind === 'another inconsistent census row')
      data.rows.push({ ...data.rows[0], key: 'other-day', date: '2026-10-01', firstName: 'Otra' });
    if (kind === 'another surname partition')
      data.rows.push({
        ...data.rows[0],
        key: 'other-day',
        date: '2026-10-01',
        firstName: 'Ana Prueba',
        lastName: 'Ejemplo',
        secondLastName: '',
      });
    const output = applyCudyrMonthlySources(data, [source]);
    expect(output.rows.find(r => r.key === data.rows[0].key)?.evaluation).toBeNull();
  });
  it('does not resolve competing source rows by matching their category', () => {
    const { data, report, source } = fixture();
    report.patients.push({
      ...report.patients[0],
      sourceRow: 999,
      patientName: data.rows[0].patientName,
    });
    const output = applyCudyrMonthlySources(data, [source]);
    expect(output.rows.find(r => r.key === data.rows[0].key)?.evaluation).toBeNull();
  });
  it('keeps eligible and excluded status independent of source availability', () => {
    const { data, source } = fixture();
    data.rows[0].eligibility = 'no_elegible';
    const row = applyCudyrMonthlySources(data, [source]).rows[0];
    expect(row.eligibility).toBe('no_elegible');
    expect(row.evaluation?.category).toBe('C2');
  });
  it('does not let single-report comparison override a conflicting identity in another archive', () => {
    const { data, source } = fixture();
    data.rows[0].evaluation = {
      category: 'C2',
      source: 'Eloísa',
      recordedAt: '2026-10-03T08:00:00Z',
      sourceEvaluationId: 'event',
      author: '',
      authorId: '',
      authorRole: '',
      metadataWarning: '',
    };
    const conflict = structuredClone(source);
    conflict.id = 'conflicting-source';
    conflict.report.patients[0].patientName = 'Otra Persona Ejemplo';
    const output = applyCudyrMonthlySources(data, [source, conflict]);
    const check = verifyCudyrMonthlySources(output, [source, conflict]).checks.find(
      c => c.key.startsWith('source:') && c.state === 'found'
    );
    expect(check?.needsReview).toBe(true);
    expect(output.rows.find(r => r.key === data.rows[0].key)?.monthlyEvidence).toBeUndefined();
  });
  it('accepts the same supported spacing correction inside census display names', () => {
    const { data, source } = fixture('Ana Maria', 'Prueba', '', 'ANA MARIA PRUEBA NOINFORMADO');
    data.rows[0].patientName = 'Anamaria Prueba';
    const result = applyCudyrMonthlySources(data, [source]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].monthlyEvidence?.state).toBe('found');
  });
  it('does not treat identical given and family words as different people', () => {
    const { data, source } = fixture('Prueba', 'Prueba', '', 'Prueba Prueba Noinformado');
    const result = applyCudyrMonthlySources(data, [source]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].monthlyEvidence?.identityMatch).toBe('census_name_normalization');
  });
  it('uses a validated RUN for a unique adult episode despite missing middle names', () => {
    const { data, source } = fixture('Ana Maria', 'Prueba', 'Ejemplo', 'ANA PRUEBA EJEMPLO');
    data.rows[0].rut = '11.111.111-1';
    source.report.patients[0].document = '11111111-1';
    const result = applyCudyrMonthlySources(data, [source]);
    expect(result.rows.find(r => r.key === data.rows[0].key)?.evaluation?.category).toBe('C2');
  });
  it('does not merge distinct source identities that share a maternal RUN and first given name', () => {
    const { data, source } = fixture('Ana Maria', 'Prueba', 'Ejemplo', 'Ana Prueba Ejemplo');
    data.rows[0].rut = '11.111.111-1';
    source.report.patients[0].document = '11111111-1';
    source.report.patients.push({
      ...source.report.patients[0],
      sourceRow: 999,
      patientName: 'Ana Sofia Prueba Ejemplo',
    });
    const result = applyCudyrMonthlySources(data, [source]);
    expect(result.rows.filter(r => r.contextSource === 'eloisa_monthly_report')).toHaveLength(2);
    expect(result.rows.find(r => r.key === data.rows[0].key)?.monthlyEvidence).toBeUndefined();
  });
  it('does not merge a named newborn without RN prefix into a mother sharing a validated RUN', () => {
    const { data, source } = fixture(
      'Pia Constanza',
      'Prueba',
      'Ejemplo',
      'Pia Constanza Prueba Ejemplo'
    );
    data.rows[0].rut = '11.111.111-1';
    source.report.patients[0].document = '11111111-1';
    source.report.patients.push({
      ...source.report.patients[0],
      sourceRow: 999,
      patientName: 'Amelie Solange Prueba Ejemplo',
    });
    const result = applyCudyrMonthlySources(data, [source]);
    expect(
      result.rows.filter(r => r.clinicalEpisodeId === data.rows[0].clinicalEpisodeId)
    ).toHaveLength(1);
    expect(
      result.rows.some(
        r => r.patientName === 'Amelie Solange Prueba Ejemplo' && r.eligibility === 'por_revisar'
      )
    ).toBe(true);
  });
});
