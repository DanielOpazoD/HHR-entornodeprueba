import { EMPTY_PATIENT } from '@/constants/patient';
import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const resolveSafeEpisodes = (
  beds: DailyRecord['beds'],
  conflicts: CensusImportDiff['conflicts']
): readonly string[] => {
  const record = {
    date: '2026-09-21',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-09-21T12:00:00.000Z',
    rayenSync: { runId: 'run-1', status: 'applied', at: '2026-09-21T12:00:00Z', by: 'Prueba' },
    rayenSyncHistory: [
      {
        id: 'run-1',
        startedAt: '2026-09-21T11:00:00.000Z',
        by: 'Operador HHR',
        status: 'applied',
        policy: { mode: 'preview', revision: 1 },
      },
    ],
  } as DailyRecord;
  return resolveConfirmedRayenCensusHandoff(
    { record, result: { date: record.date, outcome: 'clean' } as SaveDailyRecordResult },
    { date: record.date, runId: 'run-1', diff: { conflicts } as CensusImportDiff }
  ).safeClinicalEpisodeIds;
};

describe('Rayen clinical conflict scope', () => {
  const safePatient = {
    ...EMPTY_PATIENT,
    bedId: 'H1C1',
    patientName: 'Paciente seguro',
    rut: '22.222.222-2',
    clinicalEpisodeId: 'episode-safe',
  };

  it('blocks every principal and crib episode sharing an ambiguous report RUN', () => {
    expect(
      resolveSafeEpisodes(
        {
          H1C1: safePatient,
          H2C1: {
            ...EMPTY_PATIENT,
            bedId: 'H2C1',
            patientName: 'Madre en conflicto',
            rut: '11.111.111-1',
            clinicalEpisodeId: 'episode-mother',
            clinicalCrib: {
              ...EMPTY_PATIENT,
              bedId: 'H2C1-RN',
              patientName: 'RN en conflicto',
              rut: '11.111.111-1',
              clinicalEpisodeId: 'episode-newborn',
            },
          },
        } as DailyRecord['beds'],
        [
          {
            bedId: null,
            rut: '11.111.111-1',
            scope: 'report-row-subject',
            reason: 'Dos episodios posibles para el mismo RUN.',
          },
        ]
      )
    ).toEqual(['episode-safe']);
  });

  it('allows independently verified episodes when the ambiguous RUN is disjoint', () => {
    expect(
      resolveSafeEpisodes({ H1C1: safePatient } as DailyRecord['beds'], [
        {
          bedId: null,
          rut: '11.111.111-1',
          scope: 'report-row-subject',
          reason: 'Alta de otro paciente sin episodio verificable.',
        },
      ])
    ).toEqual(['episode-safe']);
  });

  it('keeps a bedless authority outage global even when it includes a RUN', () => {
    expect(
      resolveSafeEpisodes({ H1C1: safePatient } as DailyRecord['beds'], [
        {
          bedId: null,
          rut: '11.111.111-1',
          reason: 'No se pudo consultar la autoridad administrativa.',
        },
      ])
    ).toEqual([]);
  });
});
