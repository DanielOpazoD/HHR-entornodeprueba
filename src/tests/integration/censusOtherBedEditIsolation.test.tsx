import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { PatientRow } from '@/features/census/components/PatientRow';
import { usePatientRowRuntime } from '@/features/census/components/patient-row/usePatientRowRuntime';
import { DailyRecordProvider } from '@/context/DailyRecordContext';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { BEDS } from '@/constants/beds';
import { useDailyRecord } from '@/hooks/useDailyRecord';
import {
  markDailyRecordRemoteConfirmed,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus } from '@/types/domain/patientClassification';
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
    subscribeDetailed: vi.fn(() => vi.fn()),
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

// The real row, counted: each call is one render of that bed's row.
vi.mock('@/features/census/components/patient-row/usePatientRowRuntime', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/features/census/components/patient-row/usePatientRowRuntime')
    >();
  return { usePatientRowRuntime: vi.fn(actual.usePatientRowRuntime) };
});
vi.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => {}, default: () => {} }));

const date = '2026-05-17';
const rowBeds = BEDS.filter(bed => bed.id === 'R1' || bed.id === 'R2');
const onAction = () => {};

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

/** The census as the app wires it: the real day hook feeds the real provider and rows. */
const Census = () => {
  const day = useDailyRecord(date, 'ready');
  if (!day.record) return null;
  const record = day.record;
  return (
    <DailyRecordProvider value={day}>
      <table>
        <tbody>
          {rowBeds.map(bed => (
            <PatientRow
              key={bed.id}
              data={record.beds[bed.id]}
              bed={bed}
              currentDateString={date}
              onAction={onAction}
              bedType={bed.type}
            />
          ))}
        </tbody>
      </table>
    </DailyRecordProvider>
  );
};

const rendersOf = (bedId: string) =>
  vi.mocked(usePatientRowRuntime).mock.calls.filter(([params]) => params.bed.id === bedId).length;

describe('editing one census bed', () => {
  it('saves the change without drawing the other beds again', async () => {
    setFirestoreEnabled(true);
    resetDailyRecordFreshnessGateForTests();
    let stored = DataFactory.createMockDailyRecord(date, {
      beds: Object.fromEntries(
        rowBeds.map(bed => [
          bed.id,
          DataFactory.createMockPatient(bed.id, {
            patientName: `PACIENTE SINTETICO ${bed.id}`,
            rut: bed.id === 'R1' ? '11.111.111-1' : '12.345.678-5',
            clinicalEpisodeId: `episode-${bed.id}`,
            status: PatientStatus.ESTABLE,
            admissionDate: date,
          }),
        ])
      ),
    });
    ports.getForDate.mockImplementation(async () => stored);
    ports.getAuthoritativeForDate.mockImplementation(async () => stored);
    ports.getForDateWithMeta.mockImplementation(async () => readResult(stored));
    ports.updatePartialDetailed.mockImplementation(async (_date, patch) => {
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
    const rowOf = async (bedId: string) =>
      (await screen.findAllByTestId('patient-row')).find(row => row.dataset.bedId === bedId)!;
    const r1 = await rowOf('R1');
    await waitFor(() => expect(rendersOf('R2')).toBeGreaterThan(0));
    const otherBedRenders = rendersOf('R2');

    fireEvent.click(within(r1).getByTestId('clinical-status'));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Estado clínico' })).getByRole('button', {
        name: PatientStatus.DE_CUIDADO,
      })
    );

    await waitFor(() =>
      expect(within(r1).getByRole('button', { name: 'Estado: De cuidado' })).toBeVisible()
    );
    await waitFor(() => expect(stored.beds.R1.status).toBe(PatientStatus.DE_CUIDADO));
    await waitFor(() => expect(rendersOf('R1')).toBeGreaterThan(1));
    expect(stored.beds.R2.status).toBe(PatientStatus.ESTABLE);
    expect(rendersOf('R2')).toBe(otherBedRenders);
  });
});
