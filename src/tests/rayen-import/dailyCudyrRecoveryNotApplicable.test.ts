// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { recoverDailyCudyrGap } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  currentDay,
  historicalDay,
  now,
  parsedSource,
  patient,
} from './dailyCudyrRecovery.fixtures';

const otherPatient = (admission: { admissionDate: string; admissionTime?: string }) => ({
  ...patient(),
  patientName: 'Otra Paciente Sintética',
  rut: '22.222.222-2',
  clinicalEpisodeId: 'synthetic-episode-b',
  ...admission,
});
const dayWith = (bedPatient: ReturnType<typeof patient>): DailyRecord => ({
  ...historicalDay(),
  beds: { R1: bedPatient },
});
const gapFor = (bedPatient: ReturnType<typeof patient>) => ({
  clinicalEpisodeId: bedPatient.clinicalEpisodeId,
  date: '2026-10-26',
  sourceDate: '2026-10-27',
  patient: bedPatient,
});
const recover = (bedPatient: ReturnType<typeof patient>) =>
  recoverDailyCudyrGap(gapFor(bedPatient), [dayWith(bedPatient)], parsedSource());

describe('CUDYR recovery for a patient under eight hours at the cutoff', () => {
  it.each([
    ['in the early hours of the next day', { admissionDate: '2026-10-27', admissionTime: '00:22' }],
    ['late on the same day', { admissionDate: '2026-10-26', admissionTime: '18:30' }],
  ])('expects no record when admitted %s', (_case, admission) => {
    expect(recover(otherPatient(admission))).toEqual({ kind: 'not_applicable' });
  });

  it('answers «not recorded» for an eligible patient when the report covers that morning', () => {
    expect(recover(otherPatient({ admissionDate: '2026-10-20' }))).toEqual({
      kind: 'not_recorded',
    });
  });

  it('stays inconclusive when the report has no category at all for that morning', () => {
    const empty = parsedSource();
    empty.report.patients = [];
    const eligible = otherPatient({ admissionDate: '2026-10-20' });
    expect(recoverDailyCudyrGap(gapFor(eligible), [dayWith(eligible)], empty)).toEqual({
      kind: 'documentary_inconclusive',
    });
  });

  it('does not mark the sync as failed for a CUDYR nobody recorded', async () => {
    const eligible = otherPatient({ admissionDate: '2026-10-20' });
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => dayWith(eligible),
      capture: async () => parsedSource(),
    });
    const result = await reader({ ...currentDay(), beds: {} }, [eligible.clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.previous).toEqual([]);
  });

  it('stays inconclusive when the admission date is missing, since nothing proves the short stay', () => {
    expect(recover(otherPatient({ admissionDate: '' }))).toEqual({
      kind: 'documentary_inconclusive',
    });
  });

  it('keeps a valid record found for a patient who was not eligible (CUD-02)', () => {
    const resolution = recover({
      ...patient(),
      admissionDate: '2026-10-27',
      admissionTime: '00:22',
    });

    expect(resolution).toMatchObject({ kind: 'recovered', cudyr: { category: 'C2' } });
  });

  it('does not turn the sync partial over it', async () => {
    const previous = dayWith(otherPatient({ admissionDate: '2026-10-27', admissionTime: '00:22' }));
    const current: DailyRecord = {
      ...currentDay(),
      discharges: [],
      beds: { R1: otherPatient({ admissionDate: '2026-10-27', admissionTime: '00:22' }) },
    };
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async date =>
        date === previous.date ? previous : date === current.date ? current : null,
      capture: vi.fn(async () => parsedSource()),
    });

    const result = await reader(current, ['synthetic-episode-b'], {
      map: new Map(),
      historyAvailable: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.previous).toEqual([]);
  });
});

describe('CUDYR recovery for a patient identified by passport (ID-01)', () => {
  const PASSPORT = 'N12345678';
  const passportPatient = (rut = PASSPORT) =>
    ({ ...patient(), rut, documentType: 'Pasaporte' }) as unknown as ReturnType<typeof patient>;
  const reportWithPassport = (night: 'category' | 'blank') => {
    const source = parsedSource();
    const answered = structuredClone(source.report.patients[0]);
    source.report.patients[0] = {
      ...source.report.patients[0],
      document: PASSPORT,
      days: source.report.patients[0].days.map(day =>
        day.sourceDate === '2026-10-27' && night === 'blank'
          ? { ...day, category: null, state: 'blank' as const }
          : day
      ),
    };
    // Another patient was categorized that morning, so the report covers it.
    source.report.patients.push({
      ...answered,
      document: '22.222.222-2',
      patientName: 'Otra Paciente Sintética',
    });
    return source;
  };
  const resolve = (bedPatient: ReturnType<typeof patient>, source = parsedSource()) =>
    recoverDailyCudyrGap(gapFor(bedPatient), [dayWith(bedPatient)], source);

  it('answers «not recorded» when the same passport and name left that night blank', () => {
    expect(resolve(passportPatient(), reportWithPassport('blank'))).toEqual({
      kind: 'not_recorded',
    });
  });

  it('never writes a documentary category for a passport; a person enters it', () => {
    expect(resolve(passportPatient(), reportWithPassport('category'))).toEqual({
      kind: 'attribution_unreliable',
    });
  });

  it('never compares a passport as a RUN, even when it reads as one', () => {
    expect(resolve(passportPatient(patient().rut))).toEqual({ kind: 'attribution_unreliable' });
  });

  it('does not keep the sync partial over a passport night nobody recorded', async () => {
    const admitted = passportPatient();
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => dayWith(admitted),
      capture: async () => reportWithPassport('blank'),
    });

    const result = await reader({ ...currentDay(), beds: {} }, [admitted.clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.previous).toEqual([]);
  });

  it('stays unattributable without its own row or with another name on it', () => {
    const missing = reportWithPassport('blank');
    missing.report.patients = missing.report.patients.slice(1);
    expect(resolve(passportPatient(), missing)).toEqual({ kind: 'attribution_unreliable' });

    const renamed = reportWithPassport('blank');
    renamed.report.patients[0] = { ...renamed.report.patients[0], patientName: 'Nombre Distinto' };
    expect(resolve(passportPatient(), renamed)).toEqual({ kind: 'attribution_unreliable' });
  });
});
