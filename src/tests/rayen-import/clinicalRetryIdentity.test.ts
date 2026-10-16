import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalFillSummary } from '@/features/rayen-import/contracts/clinicalFillContracts';
import {
  mergeClinicalRetrySummary,
  resolveClinicalStageResult,
} from '@/features/rayen-import/domain/clinicalStageResolution';

const record = {
  date: '2026-10-15',
  beds: { R2: { bedId: 'R2', patientName: 'Paciente sintético', clinicalEpisodeId: 'moved' } },
  discharges: [],
  transfers: [],
  cma: [],
} as unknown as DailyRecord;
const summary = (errors: ClinicalFillSummary['errors']): ClinicalFillSummary => ({
  total: 2,
  patched: 0,
  errors,
});
const issue = (clinicalEpisodeId?: string, bedId = 'R1') => ({
  bedId,
  clinicalEpisodeId,
  source: 'devices' as const,
  reason: 'source_unavailable' as const,
  message: 'Fuente no disponible',
});

describe('clinical retries follow the episode across beds', () => {
  it('retries a failed episode at its current location, retaining source selection', () => {
    const result = resolveClinicalStageResult(
      record,
      record,
      ['moved'],
      summary([issue('moved')]),
      false
    );
    expect(result).toMatchObject({
      retry: { pendingClinicalEpisodeIds: ['moved'], pendingReads: { moved: ['devices'] } },
    });
  });

  it('does not reread a newborn when only its mother needs a device retry', () => {
    const shared = {
      ...record,
      beds: {
        R2: {
          ...record.beds.R2,
          clinicalCrib: {
            ...record.beds.R2,
            patientName: 'RN sintético',
            clinicalEpisodeId: 'newborn',
          },
        },
      },
    } as DailyRecord;
    expect(
      resolveClinicalStageResult(shared, shared, undefined, summary([issue('moved', 'R2')]), false)
    ).toMatchObject({ retry: { pendingClinicalEpisodeIds: ['moved'] } });
  });

  it('clears the moved episode error after recovery, preserving another episode at the old bed', () => {
    const other = issue('other');
    const merged = mergeClinicalRetrySummary(
      summary([issue('moved'), other]),
      summary([]),
      new Set(['R2']),
      new Set(['moved'])
    );
    expect(merged.errors).toEqual([other]);
  });

  it('does not clear a different episode just because it now occupies the retried bed', () => {
    const other = issue('other', 'R2');
    const merged = mergeClinicalRetrySummary(
      summary([other]),
      summary([]),
      new Set(['R2']),
      new Set(['moved'])
    );
    expect(merged.errors).toEqual([other]);
  });

  it('retains bed fallback for older errors without an episode identifier', () => {
    const legacy = issue(undefined, 'R2');
    const result = resolveClinicalStageResult(record, record, ['moved'], summary([legacy]), false);
    expect(result).toMatchObject({ retry: { pendingClinicalEpisodeIds: ['moved'] } });
    expect(
      mergeClinicalRetrySummary(summary([legacy]), summary([]), new Set(['R2']), new Set(['moved']))
        .errors
    ).toEqual([]);
  });
});
