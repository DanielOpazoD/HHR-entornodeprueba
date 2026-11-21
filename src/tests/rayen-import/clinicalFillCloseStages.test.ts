import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

// What a sync run does after its clinical save and before it closes, and how long each part takes.
const SCALE_EVENT = {
  publishDatetime: '2026-07-10T10:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17' },
  ],
};

const record = (): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-07-10', {
    beds: {
      R1: {
        ...createEmptyPatient('R1'),
        patientName: 'Paciente Sintético',
        rut: '12.345.678-5',
        clinicalEpisodeId: 'E1',
        devices: [],
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  });

const setup = (archiveResult: 'persisted' | 'failed') => {
  let clock = 0;
  const events: string[] = [];
  let releaseArchive: (() => void) | undefined;
  const deps: ClinicalFillDeps = {
    monotonicNow: () => clock,
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn().mockResolvedValue({ events: [SCALE_EVENT], nursingActivity: [] }),
    fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
      observedEpisodeIds: ['E1'],
      metadataStatus: 'complete',
    }),
    recoverCudyrPlacements: vi.fn(async () => {
      clock += 100;
      return [];
    }),
    archiveCudyrCapture: vi.fn(
      () =>
        new Promise<'persisted' | 'failed'>(resolve => {
          releaseArchive = () => {
            events.push('archive');
            resolve(archiveResult);
          };
        })
    ),
    applyPatch: vi.fn(async () => {
      clock += 1000;
      events.push('save');
    }),
    registerStaff: vi.fn(async observations => {
      clock += 300;
      events.push('staff');
      return observations;
    }),
    now: () => new Date('2026-07-10T12:00:00.000Z'),
    createId: () => '00000000-0000-4000-8000-000000000001',
  };
  return {
    deps,
    events,
    finishArchive: (afterMs: number) => {
      clock += afterMs;
      releaseArchive?.();
    },
  };
};

describe('closing a sync run after its clinical save', () => {
  it('registers staff after the save, closes only once the CUDYR archive settles and measures each part', async () => {
    const { deps, events, finishArchive } = setup('persisted');
    let closed = false;
    const run = runClinicalFill(record(), '2026-07-10', deps).then(summary => {
      closed = true;
      return summary;
    });

    await vi.waitFor(() => expect(events).toEqual(['save', 'staff']));
    expect(deps.archiveCudyrCapture).toHaveBeenCalledOnce();
    expect(closed).toBe(false);

    finishArchive(2000);
    const summary = await run;

    expect(events).toEqual(['save', 'staff', 'archive']);
    expect(summary.errors).toEqual([]);
    expect(summary.patched).toBe(1);
    const stages = summary.performance!.stagesMs;
    // The wait after the save is the staff registry plus what the archive still had left.
    expect(stages.closeWait).toBe(2300);
    expect(stages.staffRegistration).toBe(300);
    expect(stages.cudyrArchivePlacementReads).toBe(100);
    expect(stages.cudyrArchiveWrites).toBeGreaterThanOrEqual(2300);
    expect(stages.cudyrArchive).toBeGreaterThanOrEqual(stages.cudyrArchiveWrites! + 100);
    expect(JSON.stringify(summary.performance)).not.toMatch(/Sintético|E1|R1|12\.345/);
  });

  it('still reports a failed archive part as the same run error, with the wait measured', async () => {
    const { deps, events, finishArchive } = setup('failed');
    const run = runClinicalFill(record(), '2026-07-10', deps);
    await vi.waitFor(() => expect(events).toEqual(['save', 'staff']));
    finishArchive(500);
    const summary = await run;

    expect(summary.errors).toMatchObject([
      { clinicalEpisodeId: 'E1', source: 'cudyr', reason: 'historical_archive_failed' },
    ]);
    expect(summary.performance!.stagesMs.closeWait).toBe(800);
  });

  it('leaves the archive unmeasured, never zero, when the run archives nothing', async () => {
    const { deps } = setup('persisted');
    const summary = await runClinicalFill(record(), '2026-07-10', {
      ...deps,
      archiveCudyrCapture: undefined,
    });

    const stages = summary.performance!.stagesMs;
    expect(stages.staffRegistration).toBe(300);
    expect(stages.closeWait).toBe(300);
    expect(stages).not.toHaveProperty('cudyrArchive');
    expect(stages).not.toHaveProperty('cudyrArchivePlacementReads');
    expect(stages).not.toHaveProperty('cudyrArchiveWrites');
  });
});
