import { it, expect } from 'vitest';
import { cudyrExclusionSummary } from '@/services/cudyr/cudyrExclusionSummary';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';
it('counts excluded patient-days independently of recorded CUDYR and distinct people', () => {
  const row = buildCudyrReport(confirmedReportInput()).rows[0];
  const rows = [
    { ...row, key: 'one', eligibility: 'no_elegible' as const, modality: 'uea' as const },
    {
      ...row,
      key: 'two',
      date: '2026-10-03',
      eligibility: 'no_elegible' as const,
      modality: 'hospitalizacion' as const,
      eligibilityReason: 'Hospitalización menor de 8 horas',
    },
    {
      ...row,
      key: 'rn',
      clinicalEpisodeId: 'newborn',
      patientName: 'RN sintético',
      eligibility: 'no_elegible' as const,
      modality: 'cuna' as const,
    },
    {
      ...row,
      key: 'discharge',
      eligibility: 'no_elegible' as const,
      resolvedSystemDeparture: true,
    },
    {
      ...row,
      key: 'open',
      eligibility: 'no_elegible' as const,
      modality: 'uea' as const,
      applicationPending: true,
    },
    { ...row, key: 'eligible', eligibility: 'elegible' as const },
  ];
  const result = cudyrExclusionSummary(rows);
  expect(result.patientDays).toBe(4);
  expect(result.patients).toBe(2);
  expect(result.withCudyr).toBe(4);
  expect(result.groups.map(g => g.key)).toEqual(['uea', 'cuna', 'under_eight_hours']);
});
it('separates CMA locations and retains unknown location without guessing', () => {
  const row = buildCudyrReport(confirmedReportInput()).rows[0];
  const result = cudyrExclusionSummary(
    ['Pabellón-R1 CMA', 'CMA R1 Hospitalizados', 'CMA'].map((bedName, i) => ({
      ...row,
      key: String(i),
      bedName,
      modality: 'cma',
      eligibility: 'no_elegible',
    }))
  );
  expect(result.groups.map(g => g.key)).toEqual(['cma_pabellon', 'cma_hospitalizados', 'cma']);
});
