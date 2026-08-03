import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from '@/features/rayen-import';
import { buildClinicalPatientPatch } from '@/features/rayen-import/domain/clinicalPatientPatch';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/features/rayen-import/contracts/rayenDomainContracts';
import { applyPatches } from '@/utils/patchUtils';

/** Real-shaped Braden 17 (07-10) as a slimmed clinical-history event from the panel de historial. */
const BRADEN_HISTORY_EVENT = {
  publishDatetime: '2026-07-10T08:00:00',
  evaluationInstrumentsResume: [
    { FORM_NAME: 'Escala de riesgo UPP (Braden)', LABEL: 'Puntaje', VALUE: '17', ARCHIVED: false },
    {
      FORM_NAME: 'Escala de riesgo UPP (Braden)',
      LABEL: 'Nivel de Severidad',
      VALUE: 'Riesgo bajo',
      ARCHIVED: false,
    },
  ],
};

const record = (beds: Record<string, { encId?: string; name?: string }>): DailyRecord =>
  ({
    date: '2026-07-10',
    beds: Object.fromEntries(
      Object.entries(beds).map(([bedId, { encId, name }]) => [
        bedId,
        { bedId, patientName: name ?? 'Paciente X', clinicalEpisodeId: encId, devices: [] },
      ])
    ),
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
  }) as unknown as DailyRecord;

const okDeps = (over: Partial<ClinicalFillDeps> = {}): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi
    .fn()
    .mockResolvedValue({ events: [BRADEN_HISTORY_EVENT], effectiveLookbackDays: 14 }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi.fn().mockResolvedValue({
    items: [{ encId: 'E1', crdValue: 'D3', crdDateTime: '2026-07-10T18:00:00+00:00' }],
  }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now: () => new globalThis.Date(Date.UTC(2026, 6, 10, 12, 0, 0)),
  createId: () => 'id-1',
  ...over,
});

describe('runClinicalFill no-op behavior', () => {
  it('excludes reconstructed clinical collections whose canonical content is unchanged', () => {
    const patient = {
      devices: [{ id: 'device-1', type: 'VVP', location: 'Brazo derecho' }],
      evaluationScores: { braden: { score: 17, recordedAt: '2026-07-10T08:00:00' } },
    } as unknown as PatientData;
    const merged = {
      ...patient,
      devices: [{ location: 'Brazo derecho', type: 'VVP', id: 'device-1' }],
      evaluationScores: { braden: { recordedAt: '2026-07-10T08:00:00', score: 17 } },
    } as unknown as PatientData;

    expect(buildClinicalPatientPatch(patient, merged, 'H1C2', false)).toEqual({
      patch: {},
      checkpointChanged: false,
      clinicalFieldCount: 0,
    });
  });

  it('persists a checkpoint-only patch after the first authoritative empty read', async () => {
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });
    const summary = await runClinicalFill(record({ H1C2: { encId: 'E1' } }), '2026-07-10', deps);

    expect(summary).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(deps.applyPatch).toHaveBeenCalledTimes(1);
    const [patch, target] = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(Object.keys(patch)).toEqual(['beds.H1C2.clinicalSyncCheckpoint']);
    expect(target).toMatchObject({ captureHistorySnapshot: false });
  });

  it('repairs persisted duplicate scales even when Eloisa reports no new application', async () => {
    const rec = record({ H1C2: { encId: 'E1', name: 'Franco Morales' } });
    rec.beds.H1C2.evaluationScores = {
      history: [
        {
          code: 'DOWNTON',
          name: 'Escala de Riesgo de caídas (Downton)',
          encounterEventId: 20260710161638,
          sourceOrder: 1,
          total: 3,
          severity: 'Riesgo alto',
          recordedDate: '2026-07-10',
          recordedAt: '2026-07-10T16:16:38',
          author: 'Valeria Salfate',
        },
        {
          code: 'DOWNTON',
          name: 'Escala de Riesgo de caídas (Downton)',
          encounterEventId: 20260710161638,
          sourceOrder: 2,
          total: 3,
          severity: 'Riesgo alto',
          recordedDate: '2026-07-10',
          recordedAt: '10-07-2026 16:16:38 -06:00',
          author: 'Constanza Guajardo',
        },
      ],
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });

    const summary = await runClinicalFill(rec, '2026-07-10', deps);

    expect(summary.patched).toBe(1);
    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(patch['beds.H1C2.evaluationScores'].history).toHaveLength(1);
    expect(patch['beds.H1C2.evaluationScores'].history[0].author).toBe('Valeria Salfate');
  });

  it('is a zero-write retry after persistence and hydration of an authoritative first pass', async () => {
    const firstRecord = record({ H1C2: { encId: 'E1' } });
    const firstDeps = okDeps();
    const firstSummary = await runClinicalFill(firstRecord, '2026-07-10', firstDeps);
    const firstPatch = (firstDeps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstPatch).toBeDefined();

    const persisted = prepareDailyRecordForPersistence(
      applyPatches(firstRecord, firstPatch),
      '2026-07-10'
    );
    const storedRecord = JSON.parse(JSON.stringify(persisted)) as DailyRecord;

    const retryDeps = okDeps();
    const summary = await runClinicalFill(storedRecord, '2026-07-10', retryDeps);

    expect(summary).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(firstSummary.incremental).toMatchObject({ patientWrites: 1, historySnapshots: 1 });
    expect(summary.incremental).toMatchObject({
      newFacts: 0,
      duplicates: 1,
      patientWrites: 0,
      historySnapshots: 0,
    });
    expect(summary.performance?.counters.patches).toBe(0);
    expect(retryDeps.applyPatch).not.toHaveBeenCalled();
  });

  it('does not certify a full history validation when the history read fails', async () => {
    const rec = record({ H1C2: { encId: 'E1' } });
    rec.beds.H1C2.clinicalSyncCheckpoint = {
      version: 2,
      fingerprintVersion: 1,
      sources: {
        scales: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
        staffing: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
      },
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({
        events: [],
        error: 'Historial clínico no disponible',
      }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });

    await runClinicalFill(rec, '2026-07-10', deps);

    const patch = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const stored = patch['beds.H1C2.clinicalSyncCheckpoint'];
    expect(stored.sources.scales.lastFullValidationAt).toBe('2026-07-08T08:00:00.000Z');
    expect(stored.sources.staffing.lastFullValidationAt).toBe('2026-07-08T08:00:00.000Z');
  });

  it('does not certify a full validation when an older extension omits the effective window', async () => {
    const rec = record({ H1C2: { encId: 'E1' } });
    rec.beds.H1C2.clinicalSyncCheckpoint = {
      version: 2,
      fingerprintVersion: 1,
      sources: {
        scales: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
        staffing: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
      },
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });

    await runClinicalFill(rec, '2026-07-10', deps);

    const stored = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0][
      'beds.H1C2.clinicalSyncCheckpoint'
    ];
    expect(stored.sources.scales.lastFullValidationAt).toBe('2026-07-08T08:00:00.000Z');
    expect(stored.sources.staffing.lastFullValidationAt).toBe('2026-07-08T08:00:00.000Z');
    expect(stored.sources.scales.lastFullValidationAttemptAt).toBe('2026-07-10T12:00:00.000Z');
    expect(stored.sources.staffing.lastFullValidationAttemptAt).toBe('2026-07-10T12:00:00.000Z');
    expect(stored.sources.scales.lastFullValidationAttemptLookbackDays).toBe(14);
    expect(stored.sources.staffing.lastFullValidationAttemptLookbackDays).toBe(14);
  });

  it('certifies a full validation only when the extension confirms the requested window', async () => {
    const rec = record({ H1C2: { encId: 'E1' } });
    rec.beds.H1C2.clinicalSyncCheckpoint = {
      version: 2,
      fingerprintVersion: 1,
      sources: {
        scales: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
        staffing: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
      },
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({
        events: [],
        nursingActivity: [],
        effectiveLookbackDays: 14,
        coverageWindowStartIsoDay: '2026-06-28',
        coverageWindowEndIsoDay: '2026-07-09',
      }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });

    await runClinicalFill(rec, '2026-07-10', deps);

    const stored = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0][
      'beds.H1C2.clinicalSyncCheckpoint'
    ];
    expect(stored.sources.scales.lastFullValidationAt).toBe('2026-07-10T12:00:00.000Z');
    expect(stored.sources.staffing.lastFullValidationAt).toBe('2026-07-10T12:00:00.000Z');
    expect(stored.sources.scales.lastFullValidationLookbackDays).toBe(14);
    expect(stored.sources.staffing.lastFullValidationLookbackDays).toBe(14);
  });

  it('does not certify a full validation from lookback metadata without coverage bounds', async () => {
    const rec = record({ H1C2: { encId: 'E1' } });
    rec.beds.H1C2.clinicalSyncCheckpoint = {
      version: 2,
      fingerprintVersion: 1,
      sources: {
        scales: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
        staffing: { facts: [], lastFullValidationAt: '2026-07-08T08:00:00.000Z' },
      },
    };
    const deps = okDeps({
      fetchHistoryScales: vi.fn().mockResolvedValue({
        events: [],
        nursingActivity: [],
        effectiveLookbackDays: 14,
      }),
      fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
      fetchCudyrCategories: vi.fn().mockResolvedValue({ items: [] }),
    });

    await runClinicalFill(rec, '2026-07-10', deps);

    const stored = (deps.applyPatch as ReturnType<typeof vi.fn>).mock.calls[0][0][
      'beds.H1C2.clinicalSyncCheckpoint'
    ];
    expect(stored.sources.scales.lastFullValidationAt).toBe('2026-07-08T08:00:00.000Z');
    expect(stored.sources.staffing.lastFullValidationAt).toBe('2026-07-08T08:00:00.000Z');
    expect(stored.sources.scales.lastFullValidationAttemptAt).toBe('2026-07-10T12:00:00.000Z');
    expect(stored.sources.scales.lastFullValidationAttemptLookbackDays).toBe(14);
    expect(stored.sources.staffing.lastFullValidationAttemptLookbackDays).toBe(14);
  });
});
