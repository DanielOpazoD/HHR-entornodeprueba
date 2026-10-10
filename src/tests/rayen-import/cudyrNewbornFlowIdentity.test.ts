import { describe, expect, it, vi } from 'vitest';
import { cudyrPlacementsFromPatientFlow } from '@/features/rayen-import/mapping/cudyrPatientFlowPlacements';
import { persistCudyrSyncCapture } from '@/features/rayen-import/domain/persistCudyrSyncCapture';
import { startCudyrSyncCapture } from '@/features/rayen-import/domain/startCudyrSyncCapture';
import { presentRayenCoverageIssue } from '@/features/rayen-import/components/rayenSyncPresentation';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';

const observedAt = '2026-10-10T04:16:00.000Z';
const flow = `Paciente: RN Ejemplo RUN Materno/progenitor(a): 11.111.111-1
09/10/2026 16:23:14 Área médica indiferenciada Área Médica Pediátrica Cunas RN Cuna R3 Intermedia Cuna R3`;

describe('CUDYR bed recovery for a newborn identified by parental RUN', () => {
  it('accepts a matching maternal header only for an explicitly identified crib episode', async () => {
    const recover = vi.fn(async (episode, rut, at, identityKind) =>
      cudyrPlacementsFromPatientFlow(flow, episode, rut, at, identityKind)
    );
    const write = vi.fn().mockResolvedValue('persisted');
    const { archive } = startCudyrSyncCapture({
      record: {
        date: '2026-10-09',
        beds: { R3: { clinicalCrib: { clinicalEpisodeId: '1001', rut: '11.111.111-1' } } },
      } as unknown as DailyRecord,
      censusDate: '2026-10-09',
      captureEpisodes: ['1001'],
      needsRead: true,
      deps: {
        fetchCudyrCategories: async () => ({
          items: [],
          source: 'gestion_camas',
          historyAvailable: true,
          captureContract: 1,
          observedEpisodeIds: [],
        }),
        archiveCudyrCapture: write,
        recoverCudyrPlacements: recover,
        now: () => new Date(observedAt),
        createId: () => 'capture',
      } as unknown as ClinicalFillDeps,
      trackRequest: operation => operation(),
      recordTimeout: vi.fn(),
    });
    expect(await archive).toEqual([]);
    expect(recover).toHaveBeenCalledWith('1001', '111111111', observedAt, 'maternal');
    expect(write.mock.calls[0][0].capture.sourcePlacements).toMatchObject([
      { clinicalEpisodeId: '1001', modality: 'cuna', sourceStartAt: '2026-10-09T16:23:14-05:00' },
    ]);
  });
  it('does not accept a maternal RUN as the personal RUN of an adult', () => {
    expect(() => cudyrPlacementsFromPatientFlow(flow, '1001', '111111111', observedAt)).toThrow();
  });
  it('rejects mismatched or contradictory newborn identity', () => {
    for (const text of [
      flow.replace('11.111.111-1', '22.222.222-2'),
      flow + '\nRUN: 22.222.222-2',
    ]) {
      expect(() =>
        cudyrPlacementsFromPatientFlow(text, '1001', '111111111', observedAt, 'maternal')
      ).toThrow();
    }
  });
  it('reports unavailable bed movements separately while keeping the CUDYR archive', async () => {
    const write = vi.fn().mockResolvedValue('persisted');
    const errors = await persistCudyrSyncCapture({
      censusDate: '2026-10-09',
      runId: 'run',
      captureId: 'capture',
      observedAt,
      episodes: ['1001'],
      source: { map: new Map(), historyAvailable: true },
      write,
      recoverPlacements: async () => {
        throw new Error('unavailable');
      },
    });
    expect(write).toHaveBeenCalledOnce();
    expect(errors).toMatchObject([{ source: 'bed_history', reason: 'source_unavailable' }]);
    expect(presentRayenCoverageIssue(errors[0])).toContain('Movimientos de camas');
  });
});
