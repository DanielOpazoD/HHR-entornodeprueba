// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { presentRayenCoverageIssue } from '@/features/rayen-import/components/rayenSyncPresentation';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import { rayenClinicalIssueTarget } from '@/features/rayen-import/components/rayenSyncIssueSupport';
import {
  now,
  patient,
  historicalDay,
  currentDay,
  parsedSource,
} from '@/tests/rayen-import/dailyCudyrRecovery.fixtures';

describe('daily documentary CUDYR recovery outcomes', () => {
  it.each([
    'blank',
    'missing',
    'passport',
    'ambiguous episode',
    'duplicate row',
    'name mismatch',
    'invalid RUT',
    'provisional identity',
  ])('%s remains an unresolved read in the persisted history', async kind => {
    const day = historicalDay(),
      report = parsedSource();
    if (kind === 'blank')
      report.report.patients[0].days[26] = {
        ...report.report.patients[0].days[26],
        category: null,
        state: 'blank',
      };
    if (kind === 'missing') report.report.patients = [];
    if (kind === 'passport') day.beds.R1.documentType = 'Pasaporte';
    if (kind === 'ambiguous episode')
      day.beds.R2 = { ...patient(), clinicalEpisodeId: 'synthetic-readmission' };
    if (kind === 'duplicate row')
      report.report.patients.push(structuredClone(report.report.patients[0]));
    if (kind === 'name mismatch') report.report.patients[0].patientName = 'Otra Persona Sintética';
    if (kind === 'invalid RUT') day.beds.R1.rut = '123';
    if (kind === 'provisional identity') day.beds.R1.identityStatus = 'provisional';
    const capture = vi.fn(async () => report);
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture,
    });
    const result = await read(day, [patient().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(result.current.size).toBe(0);
    expect(result.previous).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe('cudyr');
    const coverage = buildRayenSyncCoverage(1, result.errors, now().toISOString(), day);
    const reread = DailyRecordSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...day,
          rayenSyncHistory: [
            {
              id: 'synthetic-documentary-read',
              by: 'Synthetic tester',
              status: 'partial',
              startedAt: now().toISOString(),
              completedAt: now().toISOString(),
              coverage,
            },
          ],
        })
      )
    );
    const issue = reread.rayenSyncHistory?.[0].coverage?.issues?.[0];
    expect(issue).toMatchObject({ source: 'cudyr', reason: 'source_unavailable' });
    if (!issue) throw new Error('Missing persisted recovery issue');
    expect(issue).not.toHaveProperty('message');
    const text = presentRayenCoverageIssue(issue);
    expect(text).not.toContain('confirmar el guardado');
    expect(text).not.toContain('No registrado');
    expect(reread.beds.R1.evaluationScores?.cudyr).toBeUndefined();
  });
  it('proposes a unique positive documentary category without an error', async () => {
    const day = historicalDay();
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture: async () => parsedSource(),
    });
    const result = await read(day, [patient().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(result.current.get(patient().clinicalEpisodeId)?.category).toBe('C2');
    expect(result.errors).toEqual([]);
  });

  it.each(['2026-10-26', '2026-10-27'])(
    'links the unresolved night after selecting %s without guessing a historical bed',
    async selectedDate => {
      const previous = historicalDay();
      const current = currentDay();
      current.beds = {};
      const selected = selectedDate === previous.date ? previous : current;
      const report = parsedSource();
      report.report.patients = [];
      const reader = createDailyCudyrRecoveryReader({
        signal: new AbortController().signal,
        now,
        loadDay: async date =>
          date === previous.date ? previous : date === current.date ? current : null,
        capture: async () => report,
      });
      const result = await reader(selected, [patient().clinicalEpisodeId], {
        map: new Map(),
        historyAvailable: true,
      });
      const coverage = buildRayenSyncCoverage(1, result.errors, now().toISOString(), selected);
      expect(coverage.issues).toHaveLength(1);
      expect(coverage.issues?.map(issue => rayenClinicalIssueTarget(issue, selectedDate))).toEqual([
        { date: previous.date, bedId: null },
      ]);
    }
  );

  it('retains both unresolved nights for the same episode in the coverage', async () => {
    const previous = historicalDay();
    const current = currentDay();
    current.beds = { R1: patient() };
    const report = parsedSource();
    report.report.patients = [];
    const closed = () => new Date('2026-10-28T20:00:00-05:00');
    report.capturedAt = closed().toISOString();
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now: closed,
      loadDay: async date => (date === previous.date ? previous : null),
      capture: async () => report,
    });
    const result = await reader(current, [patient().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(result.errors).toHaveLength(2);
    const coverage = buildRayenSyncCoverage(1, result.errors, closed().toISOString(), current);
    expect(coverage.issues).toHaveLength(2);
    expect(
      coverage.issues?.map(issue => rayenClinicalIssueTarget(issue, current.date)?.date).sort()
    ).toEqual([previous.date, current.date]);
    expect(result.current.size).toBe(0);
    expect(result.previous).toEqual([]);
  });
});
