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
  it.each(
    ['11.111.111-1', '', '22.222.222-2'].flatMap(run =>
      [false, true, 'source' as const].map(independent => [run, independent] as const)
    )
  )(
    'accepts a maternal header for RN RUN %s and independent bed %s',
    async (childRun, independent) => {
      const recover = vi.fn(async (episode, rut, at, identityKind, maternalRut) =>
        cudyrPlacementsFromPatientFlow(flow, episode, rut, at, identityKind, maternalRut)
      );
      const write = vi.fn().mockResolvedValue('persisted');
      const { archive } = startCudyrSyncCapture({
        record: {
          date: '2026-10-09',
          beds: {
            R3: independent
              ? {
                  clinicalEpisodeId: '1001',
                  rut: childRun,
                  bedMode: 'Cama',
                  ...(independent === 'source'
                    ? { neonatalMaternalRut: '11.111.111-1' }
                    : {
                        neonatalPlacementDecision: {
                          clinicalEpisodeId: '1001',
                          kind: 'independent',
                          bedId: 'R3',
                          effectiveAt: '2026-10-09T14:00:00-05:00',
                          reviewedAt: observedAt,
                          reviewedBy: 'Nurse',
                          maternalRut: '11.111.111-1',
                        },
                      }),
                }
              : { rut: '11.111.111-1', clinicalCrib: { clinicalEpisodeId: '1001', rut: childRun } },
          },
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
      expect(recover).toHaveBeenCalledWith(
        '1001',
        (childRun || '11.111.111-1').replace(/[^0-9]/g, ''),
        observedAt,
        'maternal',
        '111111111'
      );
      expect(write.mock.calls[0][0].capture.sourcePlacements).toMatchObject([
        { clinicalEpisodeId: '1001', modality: 'cuna', sourceStartAt: '2026-10-09T16:23:14-05:00' },
      ]);
    }
  );
  it.each([false, true])(
    'keeps stored maternal identity after bed reuse, reviewed=%s',
    async reviewed => {
      const recover = vi.fn(async (episode, rut, at, identityKind, maternalRut) =>
        cudyrPlacementsFromPatientFlow(flow, episode, rut, at, identityKind, maternalRut)
      );
      const write = vi.fn().mockResolvedValue('persisted');
      const { archive } = startCudyrSyncCapture({
        record: {
          date: '2026-10-09',
          beds: {
            R3: {
              clinicalEpisodeId: 'replacement',
              rut: '33.333.333-3',
              clinicalCrib: {
                clinicalEpisodeId: '1001',
                rut: '',
                neonatalMaternalRut: '11.111.111-1',
                neonatalPlacementDecision: reviewed
                  ? {
                      clinicalEpisodeId: '1001',
                      kind: 'mother',
                      bedId: 'R3',
                      parentEpisodeId: 'original',
                      maternalRut: '11.111.111-1',
                      effectiveAt: observedAt,
                      reviewedAt: observedAt,
                      reviewedBy: 'Nurse',
                    }
                  : undefined,
              },
            },
          },
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
      expect(recover).toHaveBeenCalledWith(
        '1001',
        '111111111',
        observedAt,
        'maternal',
        '111111111'
      );
      expect(write.mock.calls[0][0].capture.sourcePlacements).toHaveLength(1);
    }
  );

  it('rejects a maternal header without a separately proven maternal RUN', () => {
    expect(() =>
      cudyrPlacementsFromPatientFlow(flow, '1001', '111111111', observedAt, 'maternal')
    ).toThrow();
    expect(() =>
      cudyrPlacementsFromPatientFlow(flow, '1001', '111111111', observedAt, 'maternal', '')
    ).toThrow();
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
  it('keeps personal headers authoritative when a separate maternal identity is available', () => {
    expect(() =>
      cudyrPlacementsFromPatientFlow(
        flow + '\nRUN: 33.333.333-3',
        '1001',
        '222222222',
        observedAt,
        'maternal',
        '111111111'
      )
    ).toThrow();
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
