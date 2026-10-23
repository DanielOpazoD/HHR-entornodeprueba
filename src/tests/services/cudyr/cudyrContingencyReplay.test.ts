import { expect, it } from 'vitest';
import { buildCudyrReport, cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { applyCudyrMonthlySources } from '@/services/cudyr/cudyrMonthlyProjection';
import { confirmedReportInput, reportPatient, reportRecord } from './reportFixtures';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';

it('preserves 13/13 through repeated blank monthly imports and the authorized eighth-hour exception', () => {
  const beds = [
    'R1',
    'R2',
    'R3',
    'R4',
    'NEO1',
    'NEO2',
    'H1C2',
    'H2C1',
    'H3C2',
    'H4C2',
    'H5C2',
    'H6C1',
    'H6C2',
  ];
  const patients = Object.fromEntries(
    beds.map((bedId, index) => [
      bedId,
      reportPatient({
        bedId,
        rut: `synthetic-${index}`,
        clinicalEpisodeId: `episode-${index}`,
        patientName: `Paciente Sintético ${index}`,
        cudyr: undefined,
        evaluationScores: {
          cudyr: {
            category: 'C2',
            source: 'HHR · ajuste administrativo',
            recordedDate: '2026-10-12',
            adjustmentReason: 'Contingencia de internet documentada',
            adjustmentEvidence: 'audit/synthetic',
          },
        },
      }),
    ])
  );
  patients.H1C1 = reportPatient({
    bedId: 'H1C1',
    clinicalEpisodeId: 'recent-episode',
    rut: 'recent-synthetic',
    patientName: 'Ingreso reciente sintético',
    cudyr: undefined,
    admissionDate: '2026-10-12',
    admissionTime: '16:36',
  });
  const input = confirmedReportInput({
    from: '2026-10-12',
    to: '2026-10-12',
    generatedAt: '2026-10-18T18:00:00Z',
    records: [reportRecord('2026-10-12', patients)],
    observations: [],
    captures: [],
    exclusions: [
      {
        id: 'exclusion',
        date: '2026-10-12',
        clinicalEpisodeId: 'recent-episode',
        revision: 1,
        operationId: 'synthetic',
        reason: 'under_eight_hours',
        source: 'manual',
        note: 'Ingreso 18:00 validado para CUDYR; se conserva el ingreso censal.',
        updatedAt: '2026-10-18T18:00:00Z',
        updatedBy: {
          uid: 'reviewer',
          name: 'Revisor',
          email: 'synthetic@example.test',
          role: 'admin',
        },
      },
    ],
    sourcePolicy: 'eloisa_only',
  });
  const report = supplementRequest().report;
  const template = report.patients[0];
  report.patients = Object.values(patients).map(p => ({
    ...template,
    patientName: p.patientName,
    document: p.rut,
    days: template.days.map(d => ({
      ...d,
      category: null,
      originalValue: '',
      state: 'blank' as const,
    })),
  }));
  const source = {
    id: 'blank-source',
    bytesVerified: true,
    month: '2026-10',
    report,
    importedAt: '2026-10-18T18:00:00Z',
    capture: { source: 'extension_monthly_report', observedAt: '2026-10-18T18:00:00Z' },
  } as ArchivedCudyrSupplement;
  let data = buildCudyrReport(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    data = applyCudyrMonthlySources(data, [source]);
    expect(cudyrReportTotals(data.rows)).toMatchObject({ eligible: 13, categorized: 13 });
    expect(data.rows.find(r => r.clinicalEpisodeId === 'recent-episode')?.eligibility).toBe(
      'no_elegible'
    );
    expect(input.records[0].beds.H1C1.admissionTime).toBe('16:36');
  }
});
