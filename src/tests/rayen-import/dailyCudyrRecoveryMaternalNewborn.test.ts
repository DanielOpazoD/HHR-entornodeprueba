// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { recoverDailyCudyrGap } from '@/features/rayen-import/services/dailyCudyrRecoveryPlan';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  currentDay,
  historicalDay,
  now,
  parsedSource,
  patient,
} from './dailyCudyrRecovery.fixtures';

const mother = () => ({
  ...patient(),
  bedId: 'H5C2',
  patientName: 'Camila Andrea Morales Paredes',
  rut: '11.111.111-1',
  clinicalEpisodeId: 'synthetic-mother-ep',
  admissionDate: '2026-10-25',
  admissionTime: '05:27',
});

const newbornCrib = () => ({
  ...patient(),
  bedId: 'C-H5C2',
  bedMode: 'Cuna' as const,
  patientName: 'RN Ca. Andrea Morales Paredes',
  rut: '',
  neonatalMaternalRut: '11.111.111-1',
  clinicalEpisodeId: 'synthetic-newborn-ep',
  admissionDate: '2026-10-26',
  admissionTime: '09:38',
});

const dayWithMotherAndCrib = (date: string): DailyRecord => ({
  ...(date === '2026-10-26' ? historicalDay() : currentDay()),
  date,
  beds: {
    H5C2: {
      ...mother(),
      clinicalCrib: newbornCrib(),
    },
  },
  discharges: [],
});

const gapForMother = () => ({
  clinicalEpisodeId: mother().clinicalEpisodeId,
  date: '2026-10-26',
  sourceDate: '2026-10-27',
  patient: mother(),
});

const reportWithMotherAndNewborn = ({
  motherDay27,
  newbornDay27,
  newbornName = 'RN Ca. Andrea Morales Paredes',
  includeMotherRow = true,
}: {
  motherDay27: string | null;
  newbornDay27: string | null;
  newbornName?: string;
  includeMotherRow?: boolean;
}) => {
  const source = parsedSource();
  const template = structuredClone(source.report.patients[0]);
  const withDay27 = (category: string | null) =>
    template.days.map(day =>
      day.sourceDate === '2026-10-27'
        ? {
            ...day,
            category,
            state: category ? ('category' as const) : ('blank' as const),
          }
        : day
    );
  source.report.patients = [
    // Another patient answered that morning so CUD-07 «not_recorded» is provable.
    {
      ...template,
      sourceRow: 5,
      document: '22.222.222-2',
      patientName: 'Otra Paciente Sintética',
      days: withDay27('C1'),
    },
    ...(includeMotherRow
      ? [
          {
            ...template,
            sourceRow: 43,
            document: mother().rut,
            patientName: mother().patientName,
            days: withDay27(motherDay27),
          },
        ]
      : []),
    {
      ...template,
      sourceRow: 58,
      document: mother().rut,
      patientName: newbornName,
      days: withDay27(newbornDay27),
    },
  ];
  return source;
};

describe('daily documentary CUDYR recovery for postpartum mothers sharing RUN with newborn', () => {
  it('recovers the mother CUDYR from her own row when her newborn shares her RUN in the monthly XLS', () => {
    const source = reportWithMotherAndNewborn({ motherDay27: 'D3', newbornDay27: 'D2' });
    const resolution = recoverDailyCudyrGap(
      gapForMother(),
      [dayWithMotherAndCrib('2026-10-26'), dayWithMotherAndCrib('2026-10-27')],
      source
    );
    expect(resolution).toMatchObject({
      kind: 'recovered',
      cudyr: {
        category: 'D3',
        recordedDate: '2026-10-26',
        documentaryEvidence: {
          sourceRow: 43,
          clinicalEpisodeId: 'synthetic-mother-ep',
        },
      },
    });
  });

  it('answers «not_recorded» instead of «attribution_unreliable» when mother has no category that morning', async () => {
    const source = reportWithMotherAndNewborn({ motherDay27: null, newbornDay27: 'D2' });
    const previous = dayWithMotherAndCrib('2026-10-26');
    const current = dayWithMotherAndCrib('2026-10-27');
    expect(recoverDailyCudyrGap(gapForMother(), [previous, current], source)).toEqual({
      kind: 'not_recorded',
    });

    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async date => (date === previous.date ? previous : null),
      capture: vi.fn(async () => source),
    });
    const result = await reader(current, [mother().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.previous).toEqual([]);
  });

  it('handles twin RN rows and a report where only the newborn row was categorized during the month', () => {
    const onlyNewborn = reportWithMotherAndNewborn({
      motherDay27: null,
      newbornDay27: 'D2',
      includeMotherRow: false,
    });
    expect(
      recoverDailyCudyrGap(gapForMother(), [dayWithMotherAndCrib('2026-10-26')], onlyNewborn)
    ).toEqual({ kind: 'not_recorded' });

    const withTwins = reportWithMotherAndNewborn({
      motherDay27: 'C2',
      newbornDay27: 'D2',
      newbornName: 'RN 1 Morales Paredes',
    });
    withTwins.report.patients.push({
      ...withTwins.report.patients[2],
      sourceRow: 59,
      patientName: 'RN 2 Morales Paredes',
    });
    expect(
      recoverDailyCudyrGap(gapForMother(), [dayWithMotherAndCrib('2026-10-26')], withTwins)
    ).toMatchObject({
      kind: 'recovered',
      cudyr: { category: 'C2', documentaryEvidence: { sourceRow: 43 } },
    });
  });

  it.each([
    ['unrelated adult under same RUN', 'Elena Beatriz Soto Figueroa'],
    ['unrelated RN with no shared maternal name tokens', 'RN Pedro Soto Figueroa'],
    ['plain RN prefix without name tokens', 'RN'],
  ])('still rejects %s as attribution_unreliable', (_label, competingName) => {
    const source = reportWithMotherAndNewborn({
      motherDay27: 'D3',
      newbornDay27: null,
      newbornName: competingName,
    });
    expect(
      recoverDailyCudyrGap(gapForMother(), [dayWithMotherAndCrib('2026-10-26')], source)
    ).toEqual({ kind: 'attribution_unreliable' });
  });

  it('never excludes sibling RN rows when the target patient is herself a newborn', () => {
    const independentNewborn = {
      ...mother(),
      patientName: 'RN Camila Morales',
      clinicalEpisodeId: 'synthetic-rn-own-run',
    };
    const record: DailyRecord = {
      ...historicalDay(),
      beds: { NEO1: independentNewborn },
    };
    const source = reportWithMotherAndNewborn({
      motherDay27: 'D2',
      newbornDay27: 'C2',
      newbornName: 'RN Gemelo Camila Morales',
    });
    source.report.patients[1].patientName = independentNewborn.patientName;
    expect(
      recoverDailyCudyrGap(
        {
          clinicalEpisodeId: independentNewborn.clinicalEpisodeId,
          date: '2026-10-26',
          sourceDate: '2026-10-27',
          patient: independentNewborn,
        },
        [record],
        source
      )
    ).toEqual({ kind: 'attribution_unreliable' });
  });
});
