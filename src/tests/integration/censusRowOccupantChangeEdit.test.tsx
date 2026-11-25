import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { CensusTableBody } from '@/features/census/components/CensusTableBody';
import { buildCensusBedRows } from '@/features/census/controllers/censusTableViewController';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { DefaultRepositoryProvider } from '@/context/RepositoryContext';
import { BEDS } from '@/constants/beds';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import {
  markDailyRecordRemoteConfirmed,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { createServerDailyRecordSubscriptionResult } from '@/tests/factories/dailyRecordSubscriptionResult';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { PatientData } from '@/types/domain/patient';
import { applyPatches } from '@/utils/patchUtils';
import { DataFactory } from '../factories/DataFactory';
import { ensurePatientClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
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

const serverSnapshot = (record: DailyRecord): DailyRecordReadResult =>
  createServerDailyRecordSubscriptionResult(date, record);

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

/** A provisional newborn saved without an episode: the read path derives its `legacy_ep_` id. */
const legacyNewborn = () =>
  ensurePatientClinicalEpisodeId(
    DataFactory.createMockPatient(bed.id, {
      patientName: 'RN PROVISIONAL SINTETICO',
      firstName: '',
      lastName: '',
      secondLastName: '',
      rut: '',
      identityStatus: 'provisional',
      clinicalEpisodeId: undefined,
      admissionDate: date,
      firstSeenDate: date,
      admissionTime: '07:20',
    })
  );

const columns = {
  actions: 42,
  bed: 96,
  type: 64,
  name: 190,
  access: 64,
  rut: 128,
  age: 56,
  diagnosis: 220,
  specialty: 112,
  status: 0,
  admission: 128,
  dmi: 0,
  scores: 56,
  cqx: 0,
  upc: 0,
};

/** The census as the app wires it: the real day hook and provider, and the table's own rows. */
const Census = () => {
  const day = useDailyRecord(date, 'ready');
  if (!day.record) return null;
  const { unifiedRows } = buildCensusBedRows({ visibleBeds: [bed], beds: day.record.beds });
  return (
    <DailyRecordProvider value={day}>
      <table>
        <CensusTableBody
          unifiedRows={unifiedRows}
          currentDateString={date}
          readOnly={false}
          columns={columns}
          visibleColumnCount={12}
          bedTypes={{ [bed.id]: bed.type }}
          clinicalDocumentPresenceByBedId={{}}
          onAction={() => {}}
          onActivateEmptyBed={() => {}}
        />
      </table>
    </DailyRecordProvider>
  );
};

/**
 * Renders the census with a provisional newborn in bed R1's crib, then lets the test replace that
 * newborn by a server answer, as a synchronization or another computer would.
 */
const renderCensusWithNewborn = async (
  firstNewborn: PatientData = provisionalNewborn('episode-newborn-a', 'RN DE MADRE SINTETICA')
) => {
  setFirestoreEnabled(true);
  resetDailyRecordFreshnessGateForTests();
  let stored = DataFactory.createMockDailyRecord(date, {
    beds: {
      [bed.id]: DataFactory.createMockPatient(bed.id, {
        patientName: 'MADRE SINTETICA',
        rut: '11.111.111-1',
        clinicalEpisodeId: 'episode-mother',
        admissionDate: date,
        clinicalCrib: firstNewborn,
      }),
    },
  });
  const patches: DailyRecordPatch[] = [];
  let pushServerSnapshot: ((result: DailyRecordReadResult) => void) | null = null;
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

  const replaceNewborn = async () => {
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
      pushServerSnapshot!(serverSnapshot(stored));
    });
    // The row now shows the new newborn (its name label; a focused input keeps its own text).
    await screen.findByText('RN OTRO EPISODIO');
  };
  const expectTypedNameReachedNoOne = async () => {
    // Well past the cell's pause (350 ms).
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
    });
    expect(patches.filter(patch => JSON.stringify(patch).includes(TYPED_NAME))).toEqual([]);
    expect(stored.beds[bed.id].clinicalCrib?.patientName).toBe('RN OTRO EPISODIO');
    expect(stored.beds[bed.id].clinicalCrib?.clinicalEpisodeId).toBe('episode-newborn-b');
    expect(screen.getByPlaceholderText('Nombre RN / Niño')).toHaveValue('RN OTRO EPISODIO');
  };
  /** The same newborn and episode, with one field corrected by another computer. */
  /** Another mother takes the bed, with her own newborn in the crib. */
  const replaceMother = async (newborn: PatientData) => {
    stored = {
      ...stored,
      beds: {
        ...stored.beds,
        [bed.id]: {
          ...stored.beds[bed.id],
          patientName: 'SEGUNDA MADRE SINTETICA',
          rut: '12.345.678-5',
          clinicalEpisodeId: 'ep_second_mother',
          clinicalCrib: newborn,
        },
      },
      lastUpdated: '2026-05-17T15:00:00.000Z',
    };
    await act(async () => {
      pushServerSnapshot!(serverSnapshot(stored));
    });
    await screen.findByText('SEGUNDA MADRE SINTETICA');
  };
  const correctSameNewborn = async (change: Partial<PatientData>) => {
    stored = {
      ...stored,
      beds: {
        ...stored.beds,
        [bed.id]: {
          ...stored.beds[bed.id],
          clinicalCrib: { ...stored.beds[bed.id].clinicalCrib!, ...change },
        },
      },
      lastUpdated: '2026-05-17T16:00:00.000Z',
    };
    await act(async () => {
      pushServerSnapshot!(serverSnapshot(stored));
    });
  };
  return {
    newbornName,
    replaceNewborn,
    replaceMother,
    correctSameNewborn,
    expectTypedNameReachedNoOne,
    patches,
    stored: () => stored,
  };
};

describe('a census cell whose bed changes occupant before the edit is sent (ID-03, ID-05)', () => {
  it('never writes what was typed for the previous newborn onto the newborn now in the crib', async () => {
    const { newbornName, replaceNewborn, expectTypedNameReachedNoOne } =
      await renderCensusWithNewborn();

    // The nurse types the newborn's name; the cell sends it after its pause (350 ms).
    fireEvent.change(newbornName, { target: { value: TYPED_NAME } });
    // Before that pause ends, the server answers that the crib now holds another newborn.
    await replaceNewborn();

    await expectTypedNameReachedNoOne();
  });

  it('does not send the previous newborn name when the nurse leaves the cell after the change', async () => {
    const { newbornName, replaceNewborn, expectTypedNameReachedNoOne } =
      await renderCensusWithNewborn();

    // Still in the cell, the nurse has typed; the crib changes newborn; then the nurse leaves it.
    fireEvent.focus(newbornName);
    fireEvent.change(newbornName, { target: { value: TYPED_NAME } });
    await replaceNewborn();
    fireEvent.blur(screen.getByPlaceholderText('Nombre RN / Niño'));

    await expectTypedNameReachedNoOne();
  });

  it.each([
    ['its admission time', { admissionTime: '08:37' }],
    ['its age', { age: '3d' }],
  ] as const)(
    'saves the whole name typed for the same newborn when another computer corrects %s',
    async (_field, change) => {
      const census = await renderCensusWithNewborn();

      fireEvent.focus(census.newbornName);
      for (const value of ['RN N', 'RN NUE', 'RN NUEVO SINTETICO']) {
        fireEvent.change(census.newbornName, { target: { value } });
      }
      await census.correctSameNewborn(change);
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 850));
      });

      const crib = census.stored().beds[bed.id].clinicalCrib!;
      expect(crib.clinicalEpisodeId).toBe('episode-newborn-a');
      expect(crib.patientName).toBe('RN NUEVO SINTETICO');
      expect(census.patches).toEqual([
        { [`beds.${bed.id}.clinicalCrib.patientName`]: 'RN NUEVO SINTETICO' },
      ]);
    }
  );

  it.each([
    ['in the cell', true],
    ['after leaving it', false],
  ] as const)(
    'drops the name typed for a legacy newborn when another mother and her same-looking newborn take the bed (%s)',
    async (_moment, focused) => {
      const census = await renderCensusWithNewborn(legacyNewborn());
      const firstCrib = census.stored().beds[bed.id].clinicalCrib!;
      expect(firstCrib.clinicalEpisodeId).toMatch(/^legacy_ep_/);

      if (focused) fireEvent.focus(census.newbornName);
      fireEvent.change(census.newbornName, { target: { value: TYPED_NAME } });
      await census.replaceMother(legacyNewborn());
      // Both newborns carry the same derived id: only the mother tells them apart.
      expect(census.stored().beds[bed.id].clinicalCrib?.clinicalEpisodeId).toBe(
        firstCrib.clinicalEpisodeId
      );
      if (focused) fireEvent.blur(screen.getByPlaceholderText('Nombre RN / Niño'));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 850));
      });

      expect(census.patches).toEqual([]);
      expect(census.stored().beds[bed.id].clinicalCrib?.patientName).toBe(
        'RN PROVISIONAL SINTETICO'
      );
    }
  );

  it('still saves the name typed for the same legacy newborn while its mother stays', async () => {
    const census = await renderCensusWithNewborn(legacyNewborn());

    fireEvent.change(census.newbornName, { target: { value: TYPED_NAME } });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 850));
    });

    expect(census.patches).toEqual([{ [`beds.${bed.id}.clinicalCrib.patientName`]: TYPED_NAME }]);
  });
});
