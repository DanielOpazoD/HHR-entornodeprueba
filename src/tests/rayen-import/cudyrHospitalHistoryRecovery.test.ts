import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cudyrPlacementsFromPatientFlow } from '@/features/rayen-import/mapping/cudyrPatientFlowPlacements';
import { resolveCudyrHospitalAdmission } from '@/domain/cudyr/cudyrHospitalAdmission';
import { persistCudyrSyncCapture } from '@/features/rayen-import/domain/persistCudyrSyncCapture';
import {
  recoverCudyrHospitalHistory,
  resetArchivedFlowEpisodesForTests,
} from '@/features/rayen-import/bridge/cudyrHospitalHistoryRecovery';
import { readCudyrEpisodeCaptures } from '@/services/cudyr/cudyrHistoryService';
import { requestPatientFlowReport } from '@/features/rayen-import/bridge/patientFlowBridge';
import { extractPdfTextFromBuffer } from '@/services/pdf/pdfTextExtractionRuntime';

vi.mock('@/services/cudyr/cudyrHistoryService', () => ({ readCudyrEpisodeCaptures: vi.fn() }));
vi.mock('@/features/rayen-import/bridge/patientFlowBridge', () => ({
  requestPatientFlowReport: vi.fn(),
}));
vi.mock('@/services/pdf/pdfTextExtractionRuntime', () => ({ extractPdfTextFromBuffer: vi.fn() }));
const episode = '1001';
const text = `Flujo del Paciente\nPaciente: Ejemplo RUN: 111111111
01/10/2026 09:00:00 Urgencias BOX 1 UEA B1UEA
02/10/2026 14:15:37 Área Médico Quirúrgica Servicio Hospitalizados HHR Habitacion 1 Básica H1C1
07/10/2026 20:41:00 Área Médico Quirúrgica Servicio Hospitalizados HHR Habitacion 6 Básica H6C2`;
const observedAt = '2026-10-08T15:00:00Z';
const placements = () => cudyrPlacementsFromPatientFlow(text, episode, '11.111.111-1', observedAt);

describe('historical hospital admission from the official flow report', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetArchivedFlowEpisodesForTests();
  });
  it('recovers an old October day from a report captured later, excluding Urgencias', () => {
    const history = placements().map(placement => ({
      placement,
      observedAt,
      censusDate: '2026-10-08',
      captureId: 'flow',
    }));
    expect(resolveCudyrHospitalAdmission(episode, history, '2026-10-04T06:00:00Z').at).toBe(
      '2026-10-02T14:15:37-05:00'
    );
    expect(resolveCudyrHospitalAdmission(episode, history, '2026-10-04T06:00:00Z', true).at).toBe(
      '2026-10-02T14:15:37-05:00'
    );
    expect(resolveCudyrHospitalAdmission(episode, history, '2026-10-02T06:00:00Z').at).toBe('');
    expect(resolveCudyrHospitalAdmission('another', history, '2026-10-04T06:00:00Z').at).toBe('');
    expect(placements().every(p => !p.currentAssignment && !p.sourceEndAt)).toBe(true);
  });
  it('preserves excluded locations and does not infer hospital admission from a bed code alone', () => {
    const input = `RUN: 111111111
01/10/2026 10:00:00 CMA Hospitalizados CMAR1
02/10/2026 10:00:00 Cuna RN Hospitalizados CH1C1
03/10/2026 10:00:00 Servicio desconocido H1C1
04/10/2026 10:00:00 Hospitalizados H1C1`;
    const result = cudyrPlacementsFromPatientFlow(input, episode, '111111111', observedAt);
    expect(result.map(p => p.modality)).toEqual(['cma', 'cuna', 'desconocida', 'hospitalizacion']);
  });
  it('rejects mismatched identity, invalid clocks, conflicting movements and future entries', () => {
    expect(() => cudyrPlacementsFromPatientFlow(text, episode, '222222222', observedAt)).toThrow();
    expect(() =>
      cudyrPlacementsFromPatientFlow(
        text.replace('14:15:37', '25:15:37'),
        episode,
        '111111111',
        observedAt
      )
    ).toThrow();
    expect(() =>
      cudyrPlacementsFromPatientFlow(
        text + '\n02/10/2026 14:15:37 Hospitalizados H2C2',
        episode,
        '111111111',
        observedAt
      )
    ).toThrow();
    expect(() =>
      cudyrPlacementsFromPatientFlow(text, episode, '111111111', '2026-10-06T00:00:00Z')
    ).toThrow();
  });
  it('archives recovered history even when the old episode is absent from current beds', async () => {
    const write = vi.fn().mockResolvedValue('persisted');
    const errors = await persistCudyrSyncCapture({
      censusDate: '2026-10-03',
      runId: 'run',
      captureId: 'capture',
      observedAt,
      episodes: [episode],
      source: {
        map: new Map(),
        historyAvailable: true,
        captureContract: 1,
        observedEpisodeIds: [],
      },
      recoverPlacements: async () => placements(),
      write,
    });
    expect(errors).toEqual([]);
    expect(write.mock.calls[0][0].capture).toMatchObject({
      status: 'not_observed',
      sourcePlacements: placements(),
    });
    expect(write.mock.calls[0][0].evaluations).toEqual([]);
  });
  it('archives native and mirrored flow movements without losing either source at the per-receipt limit', async () => {
    const flow = Array.from({ length: 20 }, (_, index) => ({
      ...placements()[1],
      sourceMappingId: `flow:${index}`,
      sourceStartAt: `2026-10-02T14:${String(index).padStart(2, '0')}:00-05:00`,
    }));
    const native = flow.map((p, index) => ({
      ...p,
      sourceMappingId: `native:${index}`,
      sourceVersion: 'native-v1',
    }));
    const write = vi.fn().mockResolvedValue('persisted');
    const errors = await persistCudyrSyncCapture({
      censusDate: '2026-10-03',
      runId: 'run',
      captureId: 'capture',
      observedAt,
      episodes: [episode],
      source: {
        map: new Map([
          [
            episode,
            {
              encId: episode,
              crdValue: '',
              crdDateTime: '',
              source: 'gestion_camas',
              sourcePlacements: native,
            },
          ],
        ]),
        historyAvailable: true,
        captureContract: 1,
        observedEpisodeIds: [episode],
      },
      recoverPlacements: async () => flow,
      write,
    });
    expect(errors).toEqual([]);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0][0].capture.sourcePlacements).toEqual(native);
    expect(write.mock.calls[1][0].capture).toMatchObject({
      sourcePlacements: flow,
      status: 'not_observed',
      totalEvaluations: 0,
    });
    expect(write.mock.calls[1][0].capture.id).not.toBe('capture');
    expect(write.mock.calls[1][0].evaluations).toEqual([]);
  });
  it('does not start archive writes for cancelled recovery, including queued episodes', async () => {
    const controller = new AbortController();
    const write = vi.fn().mockResolvedValue('persisted');
    const errors = await persistCudyrSyncCapture({
      censusDate: '2026-10-03',
      runId: 'run',
      captureId: 'capture',
      observedAt,
      episodes: [episode, '1002', '1003', '1004'],
      source: { map: new Map(), historyAvailable: true },
      signal: controller.signal,
      recoverPlacements: async () => {
        controller.abort();
        controller.signal.throwIfAborted();
        return [];
      },
      write,
    });
    expect(write).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });
  it('preserves native closure when the flow repeats that same hospital entry', () => {
    const source = cudyrPlacementsFromPatientFlow(
      `RUN: 111111111
02/10/2026 10:00:00 Hospitalizados H1C1
02/10/2026 20:00:00 Hospitalizados H6C2`,
      episode,
      '111111111',
      observedAt
    );
    const native = {
      ...source[0],
      sourceMappingId: 'native',
      sourceVersion: 'native-v1',
      sourceEndAt: '2026-10-02T15:00:00-05:00',
    };
    const history = [native, ...source].map(placement => ({
      placement,
      observedAt,
      censusDate: '2026-10-08',
      captureId: 'flow',
    }));
    expect(resolveCudyrHospitalAdmission(episode, history, '2026-10-03T06:00:00Z', true).at).toBe(
      '2026-10-02T20:00:00-05:00'
    );
    expect(resolveCudyrHospitalAdmission(episode, history, '2026-10-03T06:00:00Z').at).toBe(
      '2026-10-02T10:00:00-05:00'
    );
  });
  it.each(['B1UEA', 'B2UEA', 'B3UEA'])(
    'never accepts generic Hospitalizados plus %s as an inpatient bed',
    bed => {
      const result = cudyrPlacementsFromPatientFlow(
        `RUN: 111111111\n01/10/2026 10:00:00 Hospitalizados ${bed}`,
        episode,
        '111111111',
        observedAt
      );
      expect(result[0].modality).not.toBe('hospitalizacion');
    }
  );
  it('keeps the ordinary CUDYR capture and reports a failure when history recovery fails', async () => {
    const write = vi.fn().mockResolvedValue('persisted');
    const errors = await persistCudyrSyncCapture({
      censusDate: '2026-10-03',
      runId: 'run',
      captureId: 'capture',
      observedAt,
      episodes: [episode],
      source: { map: new Map(), historyAvailable: true },
      recoverPlacements: async () => {
        throw new Error('unavailable');
      },
      write,
    });
    expect(write).toHaveBeenCalledOnce();
    expect(errors).toMatchObject([{ source: 'bed_history', reason: 'source_unavailable' }]);
    expect(write.mock.calls[0][0].capture.sourcePlacements).toBeUndefined();
  });
  it.each(['queued', 'failed'])(
    'keeps a true archive %s issue even if history recovery also fails',
    async outcome => {
      const errors = await persistCudyrSyncCapture({
        censusDate: '2026-10-03',
        runId: 'run',
        captureId: 'capture',
        observedAt,
        episodes: [episode],
        source: { map: new Map(), historyAvailable: true },
        recoverPlacements: async () => {
          throw new Error('unavailable');
        },
        write: vi.fn().mockResolvedValue(outcome),
      });
      expect(errors).toMatchObject([
        { source: 'bed_history', reason: 'source_unavailable' },
        { source: 'cudyr', reason: 'historical_archive_failed' },
      ]);
    }
  );
  it('reads all archived pages before fetching a PDF and skips it once flow is persisted', async () => {
    vi.mocked(readCudyrEpisodeCaptures)
      .mockResolvedValueOnce({ captures: [], nextCursor: { id: 'next', date: '2026-10-08' } })
      .mockResolvedValueOnce({
        captures: [
          { capture: { clinicalEpisodeId: episode, sourcePlacements: placements() } },
        ] as never,
        nextCursor: null,
      });
    expect(
      await recoverCudyrHospitalHistory(
        episode,
        '111111111',
        new AbortController().signal,
        observedAt
      )
    ).toEqual([]);
    expect(readCudyrEpisodeCaptures).toHaveBeenCalledTimes(2);
    expect(requestPatientFlowReport).not.toHaveBeenCalled();
  });
  it('does not ask the server again for an episode already found in the archive', async () => {
    vi.mocked(readCudyrEpisodeCaptures).mockResolvedValue({
      captures: [{ capture: { clinicalEpisodeId: episode, sourcePlacements: placements() } }],
      nextCursor: null,
    } as never);
    const recover = () =>
      recoverCudyrHospitalHistory(episode, '111111111', new AbortController().signal, observedAt);
    await recover();
    expect(await recover()).toEqual([]);
    expect(readCudyrEpisodeCaptures).toHaveBeenCalledOnce();
    expect(requestPatientFlowReport).not.toHaveBeenCalled();
  });
  it('keeps looking up an episode the archive does not have yet', async () => {
    vi.mocked(readCudyrEpisodeCaptures).mockResolvedValue({ captures: [], nextCursor: null });
    vi.mocked(requestPatientFlowReport).mockResolvedValue({ error: 'sintético' } as never);
    const recover = () =>
      recoverCudyrHospitalHistory(episode, '111111111', new AbortController().signal, observedAt);
    await expect(recover()).rejects.toThrow();
    await expect(recover()).rejects.toThrow();
    expect(readCudyrEpisodeCaptures).toHaveBeenCalledTimes(2);
  });
  it('deduplicates repeated report rows and allows 32 unique assignments before merging', () => {
    const rows = Array.from(
      { length: 32 },
      (_, index) => `01/10/2026 10:${String(index).padStart(2, '0')}:00 Hospitalizados H1C1`
    );
    expect(
      cudyrPlacementsFromPatientFlow(
        'RUN: 111111111\n' + [...rows, ...rows].join('\n'),
        episode,
        '111111111',
        observedAt
      )
    ).toHaveLength(32);
  });
  it('rejects a movement newer than its archive receipt even if the PDF was read later', async () => {
    vi.mocked(readCudyrEpisodeCaptures).mockResolvedValue({ captures: [], nextCursor: null });
    vi.mocked(requestPatientFlowReport).mockResolvedValue({ base64: btoa('pdf') });
    vi.mocked(extractPdfTextFromBuffer).mockResolvedValue(text);
    await expect(
      recoverCudyrHospitalHistory(
        episode,
        '111111111',
        new AbortController().signal,
        '2026-10-06T15:00:00Z'
      )
    ).rejects.toThrow('Movimiento posterior');
  });
  it('fetches only missing history and stops on cancellation', async () => {
    vi.mocked(readCudyrEpisodeCaptures).mockResolvedValue({ captures: [], nextCursor: null });
    vi.mocked(requestPatientFlowReport).mockResolvedValue({ base64: btoa('pdf') });
    vi.mocked(extractPdfTextFromBuffer).mockResolvedValue(text);
    vi.useFakeTimers();
    vi.setSystemTime(observedAt);
    try {
      expect(
        await recoverCudyrHospitalHistory(
          episode,
          '111111111',
          new AbortController().signal,
          observedAt
        )
      ).toEqual(placements());
    } finally {
      vi.useRealTimers();
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      recoverCudyrHospitalHistory(episode, '111111111', controller.signal, observedAt)
    ).rejects.toThrow();
  });
});

it('keeps the complete foreign identifier from the official flow report', () => {
  const foreignText = `Flujo del Paciente\nPaciente: Persona sintética Número de Identificación: E9876543\n17/10/2026 19:38:01 Área Médico Quirúrgica Indiferenciada Área Cuidados Intermedios Adulto Servicio Hospitalizados HHR Recuperacion 2 Intermedia R2`;
  expect(
    cudyrPlacementsFromPatientFlow(foreignText, '1001', 'E9876543', '2026-10-18T02:00:00Z')
  ).toMatchObject([{ clinicalEpisodeId: '1001', bedId: 'R2', modality: 'hospitalizacion' }]);
  expect(() =>
    cudyrPlacementsFromPatientFlow(foreignText, '1001', '9876543', '2026-10-18T02:00:00Z')
  ).toThrow();
  expect(() =>
    cudyrPlacementsFromPatientFlow(foreignText, '1001', 'F9876543', '2026-10-18T02:00:00Z')
  ).toThrow();
  expect(() =>
    cudyrPlacementsFromPatientFlow(
      foreignText + '\nRUN: 9876543',
      '1001',
      'E9876543',
      '2026-10-18T02:00:00Z'
    )
  ).toThrow();
});

it('accepts a numeric passport without treating a personal header as maternal identity', () => {
  const text = `Flujo del Paciente\nNúmero de Identificación: 9876543\n17/10/2026 19:38:01 Área Médico Quirúrgica Indiferenciada Área Cuidados Intermedios Adulto Servicio Hospitalizados HHR Recuperacion 2 Intermedia R2`;
  expect(
    cudyrPlacementsFromPatientFlow(text, '1001', '9876543', '2026-10-18T02:00:00Z')
  ).toMatchObject([{ clinicalEpisodeId: '1001', bedId: 'R2', modality: 'hospitalizacion' }]);
  expect(() =>
    cudyrPlacementsFromPatientFlow(
      text + '\nRUN Materno/progenitor(a): 111111111',
      '1001',
      '222222222',
      '2026-10-18T02:00:00Z',
      'maternal',
      '111111111'
    )
  ).toThrow();
});
