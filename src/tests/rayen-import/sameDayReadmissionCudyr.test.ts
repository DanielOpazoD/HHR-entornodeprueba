// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { assertDocumentaryCudyrTarget } from '@/domain/evaluationScales/documentaryCudyr';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { recoverDailyCudyrGap } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  currentDay,
  documentary,
  historicalDay,
  now,
  parsedSource,
  patient,
} from './dailyCudyrRecovery.fixtures';

const { assertDocumentaryCudyrAuthority } = createRequire(import.meta.url)(
  '../../../functions/lib/rayenDocumentaryCudyrPolicy.js'
);

// Night 10-26 belongs to episode A, discharged 10-27 11:55; episode B is admitted 10-27 20:24.
const readmitted = (admission: { admissionDate?: string; admissionTime?: string }) => ({
  ...patient(),
  clinicalEpisodeId: 'synthetic-readmission',
  ...admission,
});
const later = readmitted({ admissionDate: '2026-10-27', admissionTime: '20:24' });
const nextDay = (bedPatient = later): DailyRecord => ({
  ...currentDay(),
  discharges: currentDay().discharges.map(discharge => ({
    ...discharge,
    time: '11:55',
    admissionDate: patient().admissionDate,
  })),
  beds: { R1: bedPatient },
});
const gap = {
  clinicalEpisodeId: patient().clinicalEpisodeId,
  date: '2026-10-26',
  sourceDate: '2026-10-27',
  patient: patient(),
};
const noCategoryForPatient = () => {
  const source = parsedSource();
  const row = source.report.patients[0];
  source.report.patients = [
    {
      ...row,
      document: '22.222.222-2',
      patientName: 'Otra Paciente Sintética',
    },
    {
      ...row,
      days: row.days.map(day => ({ ...day, category: null, state: 'blank' as const })),
    },
  ];
  return source;
};

describe('CUDYR of the night before a same-day readmission', () => {
  it('attributes the night to the discharged episode, not to the readmission', () => {
    expect(recoverDailyCudyrGap(gap, [historicalDay(), nextDay()], parsedSource())).toMatchObject({
      kind: 'recovered',
      cudyr: {
        category: 'C2',
        documentaryEvidence: { clinicalEpisodeId: patient().clinicalEpisodeId },
      },
    });
  });

  it('reports nothing to fix when nobody recorded that night', async () => {
    expect(recoverDailyCudyrGap(gap, [historicalDay(), nextDay()], noCategoryForPatient())).toEqual(
      { kind: 'not_recorded' }
    );
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async date => (date === historicalDay().date ? historicalDay() : null),
      capture: vi.fn(async () => noCategoryForPatient()),
    });
    const result = await reader(nextDay(), [patient().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.previous).toEqual([]);
  });

  it('reads the row that answers that morning when the report repeats the readmitted person', () => {
    const source = parsedSource();
    const row = source.report.patients[0];
    source.report.patients = [
      {
        ...row,
        sourceRow: row.sourceRow + 1,
        days: row.days.map(day => ({ ...day, category: null, state: 'blank' as const })),
      },
      row,
    ];
    expect(recoverDailyCudyrGap(gap, [historicalDay(), nextDay()], source)).toMatchObject({
      kind: 'recovered',
      cudyr: { documentaryEvidence: { sourceRow: row.sourceRow } },
    });
  });

  it.each([
    ['admitted on or before that night', { admissionDate: '2026-10-26', admissionTime: '20:24' }],
    ['with no admission date', { admissionDate: '' }],
  ])('stays unreliable with another episode %s', (_case, admission) => {
    expect(
      recoverDailyCudyrGap(gap, [historicalDay(), nextDay(readmitted(admission))], parsedSource())
    ).toEqual({ kind: 'attribution_unreliable' });
  });

  it('keeps the first episode from blocking a readmitted patient on their own night', () => {
    const bed = readmitted({ admissionDate: '2026-10-27', admissionTime: '12:30' });
    const day = nextDay(bed);
    expect(() =>
      assertDocumentaryCudyrTarget(day, bed, {
        ...documentary(),
        recordedDate: day.date,
        documentaryEvidence: {
          ...documentary().documentaryEvidence,
          clinicalEpisodeId: bed.clinicalEpisodeId,
          sourceDate: '2026-10-28',
        },
      })
    ).not.toThrow();
  });
});

describe('server rule for a same-day readmission', () => {
  const authorize = (sourceRecord: DailyRecord) =>
    assertDocumentaryCudyrAuthority({
      payload: {
        date: '2026-10-26',
        authorityDate: '2026-10-27',
        fieldContractVersion: 3,
        patches: [
          {
            bedId: 'R1',
            clinicalEpisodeId: patient().clinicalEpisodeId,
            fields: { evaluationScores: { cudyr: documentary() } },
          },
        ],
      },
      record: historicalDay(),
      authorityRecord: sourceRecord,
      hospitalRef: {},
      read: vi.fn(),
      valuesEqual: () => false,
    });

  it('accepts the night of the discharged episode', async () => {
    await expect(authorize(nextDay())).resolves.toBeUndefined();
  });

  it('rejects when another episode overlaps that night', async () => {
    await expect(
      authorize(nextDay(readmitted({ admissionDate: '2026-10-26', admissionTime: '20:24' })))
    ).rejects.toThrow(/unambiguous/);
  });
});
