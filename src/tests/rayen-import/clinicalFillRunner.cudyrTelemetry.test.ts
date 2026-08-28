import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const singleRecord = (date = '2026-07-10'): DailyRecord =>
  ({
    date,
    beds: {
      H1C2: { bedId: 'H1C2', patientName: 'Paciente uno', clinicalEpisodeId: 'E1', devices: [] },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const singleDeps = (over: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue({
    items: [],
    source: 'gestion_camas',
    historyAvailable: true,
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new Date('2026-07-10T12:00:00.000Z'),
  createId: () => 'id-1',
  ...over,
});

describe('runClinicalFill historical CUDYR telemetry', () => {
  it('separates historical persistence and counts every retry in aggregate history', async () => {
    let clock = 0;
    const applyHistoricalCudyrBatch = vi.fn().mockImplementation(async (_day, items) => ({
      results: items.map((item: { clinicalEpisodeId: string }) => ({
        clinicalEpisodeId: item.clinicalEpisodeId,
        persisted: true,
        changed: true,
      })),
      persistence: {
        scope: 'historical' as const,
        callableAttempts: 2,
        clientRetries: 1,
        transactionRetries: 1,
      },
    }));
    const summary = await runClinicalFill(
      singleRecord('2026-07-16'),
      '2026-07-16',
      singleDeps({
        monotonicNow: () => (clock += 10),
        fetchCudyrCategories: vi.fn().mockResolvedValue({
          items: [
            {
              encId: 'E1',
              crdValue: 'C2',
              crdDateTime: '2026-07-16T07:00:00+00:00',
              source: 'gestion_camas',
            },
          ],
          source: 'gestion_camas',
          historyAvailable: true,
        }),
        applyHistoricalCudyrBatch,
      })
    );

    expect(summary.performance).toMatchObject({
      stagesMs: {
        historicalCudyrPersistence: expect.any(Number),
        currentClinicalPersistence: expect.any(Number),
      },
      counters: { retries: 2 },
      persistenceTrace: {
        historical: {
          callableAttempts: 2,
          clientRetries: 1,
          transactionRetries: 1,
        },
      },
    });
  });

  it('keeps aggregate historical retries from a successful pre-telemetry backend', async () => {
    const summary = await runClinicalFill(
      singleRecord('2026-07-16'),
      '2026-07-16',
      singleDeps({
        fetchCudyrCategories: vi.fn().mockResolvedValue({
          items: [
            {
              encId: 'E1',
              crdValue: 'C2',
              crdDateTime: '2026-07-16T07:00:00+00:00',
              source: 'gestion_camas',
            },
          ],
          source: 'gestion_camas',
          historyAvailable: true,
        }),
        applyHistoricalCudyrBatch: vi.fn().mockImplementation(async (_day, items) => ({
          results: items.map((item: { clinicalEpisodeId: string }) => ({
            clinicalEpisodeId: item.clinicalEpisodeId,
            persisted: true,
            changed: true,
          })),
          retries: 1,
        })),
      })
    );

    expect(summary.performance).toMatchObject({ counters: { retries: 1 } });
    expect(summary.performance).not.toHaveProperty('persistenceTrace');
  });
});
