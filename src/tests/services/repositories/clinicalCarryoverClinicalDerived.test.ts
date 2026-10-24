import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

const mocks = vi.hoisted(() => ({
  isFirestoreEnabled: vi.fn(() => true),
  readDocs: vi.fn(),
  readDoc: vi.fn(),
  getForDate: vi.fn(),
  save: vi.fn(),
  loadRemote: vi.fn(),
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: mocks.isFirestoreEnabled,
}));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDocs: mocks.readDocs,
  readClinicalDerivedEpisodeDoc: mocks.readDoc,
}));
vi.mock('@/services/repositories/dailyRecordRepositoryReadService', () => ({
  getForDate: mocks.getForDate,
  getForDateWithMeta: vi.fn(),
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  save: mocks.save,
  updatePartial: vi.fn(),
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: mocks.loadRemote,
}));
vi.mock('@/services/repositories/dailyRecordLocalCachePersistence', () => ({
  persistHydratedRecordToLocalCache: vi.fn(),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: mocks.recordOperationalTelemetry,
}));

import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';
import { DataFactory } from '@/tests/factories/DataFactory';

// The Rapa Nui clock reads 2026-10-19 at this instant: the only day the carryover seeds.
const NOW = new Date('2026-10-19T16:00:00Z');
const TODAY = '2026-10-19';
const SOURCE = '2026-10-18';
const GENERATION = 'gen_synthetic_a';

const vital = (heartRate: number, hour: string): PatientVitalSigns =>
  ({
    sourceEventId: `synthetic-${heartRate}`,
    recordedDate: SOURCE,
    recordedAt: `${SOURCE} ${hour}`,
    heartRate,
  }) as PatientVitalSigns;

const sourceDay = (sourceDate = SOURCE, marked = true): DailyRecord =>
  DataFactory.createMockDailyRecord(sourceDate, {
    meta: { revision: 4 },
    ...(marked ? { clinicalDerivedLayout: { version: 1, generation: GENERATION } } : {}),
    beds: {
      R1: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente Sintético',
        clinicalEpisodeId: 'ep_synthetic',
        rut: '12345678-5',
        admissionDate: '2026-10-17',
        admissionTime: '08:00',
        vitalSigns: vital(70, '10:00'),
        vitalSignsHistory: [vital(70, '10:00')],
      }),
    },
  } as Partial<DailyRecord>);

const episodeDoc = (date = SOURCE) => ({
  schemaVersion: 1,
  date,
  clinicalEpisodeId: 'ep_synthetic',
  layoutGeneration: GENERATION,
  dayRevision: 4,
  vitalSignsHistory: [vital(70, '10:00'), vital(81, '07:00'), vital(82, '06:00')],
});

const heartRates = (record: DailyRecord) =>
  record.beds.R1.vitalSignsHistory?.map(reading => reading.heartRate);

const SECRET = 'Failed to fetch dynamically imported module: Paciente Sintético';

// The seed falls back without its documents: one reason-only event, never the exception.
const expectOneOverlayFailedEvent = () => {
  const events = mocks.recordOperationalTelemetry.mock.calls.map(([event]) => event);
  expect(events).toEqual([
    {
      category: 'firestore',
      operation: 'clinical_derived_read',
      status: 'degraded',
      runtimeState: 'degraded',
      date: SOURCE,
      issues: ['carryover_overlay_failed'],
      context: { readScope: 'day', reason: 'carryover_overlay_failed' },
    },
  ]);
  expect(sanitizeOperationalTelemetryEvent(events[0])).toMatchObject({
    issues: ['unclassified_issue'],
    context: { readScope: 'day', reason: 'carryover_overlay_failed' },
    droppedContextKeys: [],
  });
  expect(JSON.stringify(events)).not.toMatch(/fetch|Sintético|Error/);
};

const createDay = async (date: string, source: DailyRecord, initialize = initializeDay) => {
  mocks.getForDate.mockImplementation(async (requested: string) =>
    requested === source.date ? source : null
  );
  const record = await initialize(date, source.date);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(record);
  return record;
};

describe('client day creation from a split source day (D10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.isFirestoreEnabled.mockReturnValue(true);
    mocks.loadRemote.mockResolvedValue({ record: null });
    mocks.save.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("seeds today from the source's episode documents and saves only the new, unmarked day", async () => {
    const source = sourceDay();
    const before = structuredClone(source);
    mocks.readDocs.mockResolvedValueOnce({
      status: 'resolved',
      docs: [episodeDoc()],
      fromCache: false,
    });

    const created = await createDay(TODAY, source);

    expect(mocks.readDocs).toHaveBeenCalledWith(SOURCE, GENERATION, { source: 'default' });
    expect(heartRates(created)).toEqual([70, 81, 82]);
    expect(created.beds.R1.clinicalCarryover).toMatchObject({ sourceDate: SOURCE });
    expect(created.date).toBe(TODAY);
    expect(created).not.toHaveProperty('clinicalDerivedLayout');
    expect(source).toEqual(before);
  });

  it('seeds from the embedded copies, as before, when the documents cannot be read', async () => {
    mocks.readDocs.mockResolvedValueOnce({ status: 'failed', code: 'unavailable' });

    const created = await createDay(TODAY, sourceDay());

    expect(heartRates(created)).toEqual([70]);
    expect(created.beds.R1.clinicalCarryover).toMatchObject({ sourceDate: SOURCE });
    expect(created).not.toHaveProperty('clinicalDerivedLayout');
    // The reader reports its failed reads; the carryover does not report them again.
    expect(mocks.recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('seeds from the embedded copies when the read path throws, and says so once', async () => {
    mocks.readDocs.mockRejectedValueOnce(new Error(SECRET));

    const created = await createDay(TODAY, sourceDay());

    expect(heartRates(created)).toEqual([70]);
    expect(created.beds.R1.clinicalCarryover).toMatchObject({ sourceDate: SOURCE });
    expect(created).not.toHaveProperty('clinicalDerivedLayout');
    expectOneOverlayFailedEvent();
  });

  // The read path chunk never loads (a stale hash after a deploy): a day that is not overlaid must
  // not even try to load it, and so cannot report its failure.
  describe('with a read path chunk that does not load', () => {
    let readServiceLoads = 0;
    let initializeWithoutReadPath: typeof initializeDay;

    beforeEach(async () => {
      vi.resetModules();
      readServiceLoads = 0;
      vi.doMock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => {
        readServiceLoads += 1;
        throw new Error(SECRET);
      });
      ({ initializeDay: initializeWithoutReadPath } =
        await import('@/services/repositories/dailyRecordRepositoryInitializationService'));
    });
    afterEach(() => vi.doUnmock('@/services/repositories/dailyRecordClinicalDerivedReadService'));

    const expectNothingLoaded = async () => {
      // The mock factory runs only once an import settles: catches a load started in the background.
      await vi.dynamicImportSettled();
      expect(readServiceLoads).toBe(0);
      expect(mocks.readDocs).not.toHaveBeenCalled();
      expect(mocks.readDoc).not.toHaveBeenCalled();
      expect(mocks.recordOperationalTelemetry).not.toHaveBeenCalled();
    };

    it('seeds today from the embedded copies and reports it once', async () => {
      const created = await createDay(TODAY, sourceDay(), initializeWithoutReadPath);

      expect(readServiceLoads).toBe(1);
      expect(heartRates(created)).toEqual([70]);
      expect(created.beds.R1.clinicalCarryover).toMatchObject({ sourceDate: SOURCE });
      expect(created).not.toHaveProperty('clinicalDerivedLayout');
      expectOneOverlayFailedEvent();
    });

    it('loads, reads and reports nothing when the new day is not today', async () => {
      const created = await createDay(
        '2026-10-21',
        sourceDay('2026-10-20'),
        initializeWithoutReadPath
      );

      expect(created.beds.R1.vitalSignsHistory).toBeUndefined();
      expect(created).not.toHaveProperty('clinicalDerivedLayout');
      await expectNothingLoaded();
    });

    it('loads, reads and reports nothing when the source day is unmarked', async () => {
      const created = await createDay(TODAY, sourceDay(SOURCE, false), initializeWithoutReadPath);

      expect(heartRates(created)).toEqual([70]);
      expect(created.beds.R1.clinicalCarryover).toMatchObject({ sourceDate: SOURCE });
      await expectNothingLoaded();
    });
  });
});
