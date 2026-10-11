import { describe, expect, it } from 'vitest';
import {
  buildCudyrMonthlyIndicator,
  cudyrMonthlyIndicatorRange,
} from '@/services/cudyr/cudyrMonthlyIndicator';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';

describe('Monthly census CUDYR indicator', () => {
  it('uses Rapa Nui calendar today and includes a complete historical month', () => {
    expect(cudyrMonthlyIndicatorRange('2026-10-01', new Date('2026-10-10T02:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-08',
    });
    expect(cudyrMonthlyIndicatorRange('2026-08-12', new Date('2026-10-10T20:00:00Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(cudyrMonthlyIndicatorRange('2026-11-02', new Date('2026-10-10T20:00:00Z'))).toBeNull();
    expect(cudyrMonthlyIndicatorRange('2026-10-01', new Date('2026-10-01T20:00:00Z'))).toBeNull();
  });

  it('never counts today, excluded patients, or application windows still open', () => {
    const data = buildCudyrReport(confirmedReportInput());
    const row = data.rows[0];
    data.to = '2026-10-10';
    data.generatedAt = '2026-10-10T13:00:00Z';
    data.rows = [
      { ...row, date: '2026-10-08', applicationPending: false },
      {
        ...row,
        date: '2026-10-08',
        applicationPending: false,
        cudyrStatus: 'sin_registro_observado',
        evaluation: null,
      },
      { ...row, date: '2026-10-08', applicationPending: false, eligibility: 'no_elegible' },
      { ...row, date: '2026-10-09', applicationPending: true },
      { ...row, date: '2026-10-10', applicationPending: false },
    ];
    expect(buildCudyrMonthlyIndicator(data, new Date(data.generatedAt))).toMatchObject({
      percentage: 50,
      categorized: 1,
      eligible: 2,
      quality: 'Provisional',
    });
  });

  it('does not label incomplete coverage as official even when a saved snapshot exists', () => {
    const data = buildCudyrReport(confirmedReportInput());
    data.officialSnapshot = { version: 'synthetic', savedAt: data.generatedAt };
    data.issues = ['Lectura incompleta'];
    expect(buildCudyrMonthlyIndicator(data, new Date(data.generatedAt)).quality).toBe(
      'Provisional'
    );
  });
});
