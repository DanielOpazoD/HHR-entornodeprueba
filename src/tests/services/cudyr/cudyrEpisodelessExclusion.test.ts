// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cudyrArchiveCoverage } from '@/services/cudyr/cudyrArchiveCoverage';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import type { CudyrDailyExclusion } from '@/types/domain/cudyrExclusion';
import type { DischargeData } from '@/types/domain/movements';
import { reportInput, reportPatient, reportRecord } from './reportFixtures';

const DAY = '2026-10-02';
const DISCHARGE_ID = `rayen-egreso:P123456785:${DAY}`;
const now = new Date('2026-10-05T15:00:00Z');
const discharge = (patch: Partial<DischargeData> = {}): DischargeData => ({
  id: DISCHARGE_ID,
  bedName: '',
  bedId: '',
  bedType: '',
  patientName: 'Paciente Pasaporte Sintético',
  rut: 'P123456785',
  diagnosis: '',
  time: '03:10',
  status: 'Vivo',
  ...patch,
});
const exclusion = (patch: Partial<CudyrDailyExclusion> = {}): CudyrDailyExclusion => ({
  id: 'a'.repeat(64),
  date: DAY,
  clinicalEpisodeId: '',
  dischargeId: DISCHARGE_ID,
  revision: 1,
  operationId: '00000000-0000-4000-8000-000000000001',
  reason: 'under_eight_hours',
  note: 'Revisado en la ficha de origen.',
  source: 'manual',
  updatedAt: '2026-10-05T14:00:00Z',
  updatedBy: { uid: 'reviewer', name: 'Revisora', email: 'r@example.com', role: 'nurse_hospital' },
  ...patch,
});
const report = (exclusions: CudyrDailyExclusion[], beds = {}) =>
  buildCudyrReport(
    reportInput({
      from: DAY,
      to: DAY,
      records: [{ ...reportRecord(DAY, beds), discharges: [discharge()] }],
      exclusions,
      coverage: [{ date: DAY, state: 'disponible', lastSyncedAt: '', runId: '' }],
    })
  );

describe('daily exception on a discharge row without episode', () => {
  it('keeps the day pending until a person excludes that exact discharge, then verifies it', () => {
    const before = report([]);
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({ clinicalEpisodeId: '', eligibility: 'por_revisar' });
    expect(cudyrArchiveCoverage(before, now)[0].state).toBe('pending');

    const after = report([exclusion()]);
    expect(after.rows[0]).toMatchObject({
      eligibility: 'no_elegible',
      exclusion: { dischargeId: DISCHARGE_ID, reason: 'under_eight_hours' },
    });
    expect(cudyrArchiveCoverage(after, now)[0].state).toBe('complete');
  });

  it('never attaches to another discharge, another day, a withdrawn decision or an episode row', () => {
    for (const other of [
      exclusion({ dischargeId: `rayen-egreso:bed-R2:${DAY}` }),
      exclusion({ date: '2026-10-03' }),
      exclusion({ reason: null }),
    ])
      expect(report([other]).rows[0].eligibility).toBe('por_revisar');
    // An episode row is never matched by a discharge-keyed decision, nor by an empty episode.
    const withEpisode = report([exclusion()], { R1: reportPatient() });
    const episodeRow = withEpisode.rows.find(row => row.clinicalEpisodeId === 'synthetic-episode');
    expect(episodeRow?.exclusion).toBeUndefined();
  });
});
