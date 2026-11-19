import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { PatientRow } from '@/features/census/components/PatientRow';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { BEDS } from '@/constants/beds';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import {
  markDailyRecordRemoteConfirmed,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  createSyncDailyRecordResult,
  type SyncDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '../factories/DataFactory';
import { render } from './setup';

const { ports } = vi.hoisted(() => ({
  ports: {
    getForDate: vi.fn(),
    getForDateWithMeta: vi.fn(),
    getAuthoritativeForDate: vi.fn(),
    getPreviousDayWithMeta: vi.fn(),
    updatePartialDetailed: vi.fn(),
    saveDetailed: vi.fn(),
    subscribeDetailed: vi.fn(),
    syncWithFirestoreDetailed: vi.fn(),
    deleteDay: vi.fn(),
    copyPatientToDateDetailed: vi.fn(),
  },
}));

vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: ports,
  defaultDailyRecordWritePort: {
    updatePartial: ports.updatePartialDetailed,
    save: ports.saveDetailed,
    delete: ports.deleteDay,
  },
  defaultDailyRecordSyncPort: { syncWithFirestoreDetailed: ports.syncWithFirestoreDetailed },
  defaultDailyRecordRepositoryPort: ports,
}));
vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const date = '2026-05-17';
const bed = BEDS.find(candidate => candidate.id === 'R1')!;
const TYPED_NAME = 'RN SINTETICO ESCRITO';

const readResult = (record: DailyRecord) => ({
  date,
  record,
  source: 'firestore' as const,
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: 'remote_authoritative' as const,
  sourceOfTruth: 'remote' as const,
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: [],
  repairApplied: false,
});

const serverSnapshot = (record: DailyRecord): SyncDailyRecordResult =>
  createSyncDailyRecordResult({
    date,
    record,
    outcome: 'clean',
    consistencyState: 'up_to_date',
    sourceOfTruth: 'remote',
    serverConfirmed: true,
    retryability: 'not_applicable',
    recoveryAction: 'none',
    conflictSummary: null,
  });

const provisionalNewborn = (episode: string, patientName: string) =>
  DataFactory.createMockPatient(bed.id, {
    patientName,
    firstName: '',
    lastName: '',
    secondLastName: '',
    rut: '',
    identityStatus: 'provisional',
    clinicalEpisodeId: episode,
    admissionDate: date,
  });

/** The census as the app wires it: the real day hook, provider, bed row and its crib row. */
const Census = () => {
  const day = useDailyRecord(date, 'ready');
  if (!day.record) return null;
  const record = day.record;
  const crib = record.beds[bed.id].clinicalCrib;
  return (
    <DailyRecordProvider value={day}>
      <table>
        <tbody>
          <PatientRow
            key={bed.id}
            data={record.beds[bed.id]}
            bed={bed}
            currentDateString={date}
            onAction={() => {}}
            bedType={bed.type}
          />
          {crib && (
            // Same stable key as the census table: the crib row stays mounted when its occupant changes.
            <PatientRow
              key={`${bed.id}-cuna`}
              data={crib}
              bed={bed}
              currentDateString={date}
              onAction={() => {}}
              bedType={bed.type}
              isSubRow
            />
          )}
        </tbody>
      </table>
    </DailyRecordProvider>
  );
};

describe('a census cell whose bed changes occupant before the edit is sent (ID-02, ID-03)', () => {
  it('never writes what was typed for the previous newborn onto the newborn now in the crib', async () => {
    setFirestoreEnabled(true);
    resetDailyRecordFreshnessGateForTests();
    let stored = DataFactory.createMockDailyRecord(date, {
      beds: {
        [bed.id]: DataFactory.createMockPatient(bed.id, {
          patientName: 'MADRE SINTETICA',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'episode-mother',
          admissionDate: date,
          clinicalCrib: provisionalNewborn('episode-newborn-a', 'RN DE MADRE SINTETICA'),
        }),
      },
    });
    const patches: DailyRecordPatch[] = [];
    let pushServerSnapshot: ((result: SyncDailyRecordResult, pending: boolean) => void) | null =
      null;
    ports.getForDate.mockImplementation(async () => stored);
    ports.getAuthoritativeForDate.mockImplementation(async () => stored);
    ports.getForDateWithMeta.mockImplementation(async () => readResult(stored));
    ports.subscribeDetailed.mockImplementation((_date, callback) => {
      pushServerSnapshot = callback;
      return () => {};
    });
    ports.updatePartialDetailed.mockImplementation(async (_date, patch: DailyRecordPatch) => {
      patches.push(patch);
      stored = applyPatches(stored, patch);
      return { date, savedHere: true, state: 'confirmed', localCopy: 'current' };
    });
    markDailyRecordRemoteConfirmed(date, {
      source: 'query',
      confirmedRecord: stored,
      remoteLastUpdated: stored.lastUpdated,
    });

    render(
      <DefaultRepositoryProvider>
        <Census />
      </DefaultRepositoryProvider>
    );
    const newbornName = await screen.findByPlaceholderText('Nombre RN / Niño');
    await waitFor(() => expect(pushServerSnapshot).not.toBeNull());

    // The nurse types the newborn's name; the cell sends it after its pause (350 ms).
    fireEvent.change(newbornName, { target: { value: TYPED_NAME } });
    // Before that pause ends, the server answers that the crib now holds another newborn.
    stored = {
      ...stored,
      beds: {
        ...stored.beds,
        [bed.id]: {
          ...stored.beds[bed.id],
          clinicalCrib: provisionalNewborn('episode-newborn-b', 'RN OTRO EPISODIO'),
        },
      },
      lastUpdated: '2026-05-17T15:00:00.000Z',
    };
    await act(async () => {
      pushServerSnapshot!(serverSnapshot(stored), false);
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Nombre RN / Niño')).toHaveValue('RN OTRO EPISODIO')
    );

    // Well past the pause: the edit typed for the first newborn reaches no one.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
    });
    expect(patches.filter(patch => JSON.stringify(patch).includes(TYPED_NAME))).toEqual([]);
    expect(stored.beds[bed.id].clinicalCrib?.patientName).toBe('RN OTRO EPISODIO');
    expect(stored.beds[bed.id].clinicalCrib?.clinicalEpisodeId).toBe('episode-newborn-b');
    expect(screen.getByPlaceholderText('Nombre RN / Niño')).toHaveValue('RN OTRO EPISODIO');
  });
});
