// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { presentRayenCoverageIssue } from '@/features/rayen-import/components/rayenSyncPresentation';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import {
  now,
  patient,
  historicalDay,
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
});
