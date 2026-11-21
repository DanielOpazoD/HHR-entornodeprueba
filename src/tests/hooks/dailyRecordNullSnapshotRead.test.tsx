import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { usePatchDailyRecordMutation, useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { createUnconfirmedDailyRecordSubscriptionResult } from '@/tests/factories/dailyRecordSubscriptionResult';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearOperationalTelemetryEvents,
  getOperationalTelemetryEvents,
  getOperationalTelemetrySummary,
} from '@/services/observability/operationalTelemetryRecorder';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';

vi.mock('@/services/observability/operationalTelemetryExternalAdapter', () => ({
  dispatchOperationalTelemetryExternally: vi.fn(),
}));

const date = '2026-10-04';
const record = (hour: string, pathology: string) =>
  DataFactory.createMockDailyRecord(date, {
    lastUpdated: `${date}T${hour}:00:00.000Z`,
    beds: {
      R1: DataFactory.createMockPatient('R1', { clinicalEpisodeId: 'ep_synthetic', pathology }),
    },
  });
const confirmed = (hour: string, pathology: string) =>
  createDailyRecordReadResult(date, record(hour, pathology), 'firestore', {
    serverConfirmed: true,
  });
const empty = () => createUnconfirmedDailyRecordSubscriptionResult(date, null);
const recoveredCount = () => getOperationalTelemetrySummary().dailyRecordRecoveredRealtimeNullCount;

afterEach(async () => {
  cleanup();
  clearPendingDailyRecordPatchesForTests();
  resetDailyRecordFreshnessGateForTests();
  await hospitalDB.dailyRecords.clear();
  clearOperationalTelemetryEvents();
  vi.restoreAllMocks();
});

/** The census with the day confirmed by a server snapshot, as the app opens it. */
async function openConfirmedDay() {
  setFirestoreEnabled(true);
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic');
  setSessionGeneration('synthetic-generation', 'user:synthetic');
  clearOperationalTelemetryEvents();
  await hospitalDB.dailyRecords.put(record('10', 'local'));
  const repository = buildMockDailyRecordRepository();
  const client = createTestQueryClient({
    defaultOptions: { queries: { retry: 2, retryDelay: 1 } },
  });
  const read = vi.mocked(repository.getForDateWithMeta);
  read.mockImplementation(async () =>
    createDailyRecordReadResult(date, (await hospitalDB.dailyRecords.get(date))!, 'indexeddb')
  );
  const repositories = createRepositoryContainer({ dailyRecord: repository });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={repositories}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  const Census = ({ remote }: { remote: boolean }) => {
    const query = useDailyRecordQuery(
      date,
      false,
      remote ? 'ready' : 'local_only',
      remote ? 'ready' : 'bootstrapping'
    );
    const patch = usePatchDailyRecordMutation(date);
    return (
      <>
        <button
          onClick={() =>
            patch.mutate({
              partial: {
                'beds.R1.isUPC': true,
                'bedTypeOverrides.R1': 'UCI',
                'beds.R1.upcChecklist': {
                  uciCriteria: ['uci_vmi'],
                  utiCriteria: [],
                  classification: 'UPC_UCI',
                  evaluatedAt: `${date}T12:00:00Z`,
                  evaluatedForDate: date,
                  evaluatedBedId: 'R1',
                  evaluatedBy: { uid: 'synthetic-uid', displayName: 'Cuenta sintética' },
                  responsibleNurse: {
                    name: 'Enfermera sintética',
                    shift: 'day',
                    source: 'assigned',
                  },
                  reviewRequired: false,
                },
              },
              options: {
                requireConfirmedRecord: true,
                requireRemoteAuthorityFirst: true,
                requireAtomicCas: true,
              },
            })
          }
        >
          Evaluar UPC
        </button>
        <button onClick={() => patch.mutate({ 'beds.R1.pathology': 'edición local' })}>
          Editar diagnóstico
        </button>
        <output data-testid="mutation">{patch.status}</output>
        <output data-testid="day">
          {JSON.stringify({
            value: query.data?.beds.R1.pathology,
            confirmed: query.runtime?.serverConfirmed,
          })}
        </output>
      </>
    );
  };
  const view = render(<Census remote />, { wrapper: Wrapper });
  const shown = () => JSON.parse(screen.getByTestId('day').textContent!);
  await waitFor(() => expect(shown().value).toBe('local'));
  const emit = vi.mocked(repository.subscribeDetailed).mock.calls[0][1];
  await act(async () => emit(confirmed('11', 'servidor anterior')));
  await waitFor(() => expect(shown().confirmed).toBe(true));
  return {
    shown,
    read,
    emit,
    write: vi.mocked(repository.updatePartialDetailed),
    reconnect: () => {
      view.rerender(<Census remote={false} />);
      view.rerender(<Census remote />);
    },
  };
}

it('keeps the day unconfirmed after a failed read and reads the newer day when remote returns', async () => {
  const census = await openConfirmedDay();
  census.read.mockRejectedValue(new Error('synthetic offline'));
  await act(async () => census.emit(empty()));
  await waitFor(() =>
    expect(getOperationalTelemetryEvents().map(event => event.operation)).toContain(
      'reconcile_null_realtime_record'
    )
  );
  expect(census.shown()).toEqual({ value: 'servidor anterior', confirmed: false });
  expect(recoveredCount()).toBe(0);

  census.read.mockResolvedValue(confirmed('12', 'servidor nuevo'));
  census.reconnect();
  await waitFor(() => expect(census.shown()).toEqual({ value: 'servidor nuevo', confirmed: true }));
});

it('counts one recovery for two empty snapshots: only the latest read reports', async () => {
  const census = await openConfirmedDay();
  const first = Promise.withResolvers<ReturnType<typeof confirmed>>();
  const second = Promise.withResolvers<ReturnType<typeof confirmed>>();
  census.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => {
    census.emit(empty());
    census.emit(empty());
  });
  first.resolve(confirmed('12', 'primero'));
  second.resolve(confirmed('13', 'segundo'));
  await waitFor(() => expect(census.shown()).toEqual({ value: 'segundo', confirmed: true }));
  await waitFor(() => expect(recoveredCount()).toBe(1));
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  expect(recoveredCount()).toBe(1);
});

it.each([
  ['a refused server-first evaluation', 'Evaluar UPC', 'servidor anterior'],
  ['an edit left in the queue', 'Editar diagnóstico', 'edición local'],
] as const)(
  'leaves the day unconfirmed and counts no recovery when %s cancels the only read',
  async (_case, button, value) => {
    const census = await openConfirmedDay();
    const pending = Promise.withResolvers<ReturnType<typeof confirmed>>();
    census.read.mockReturnValueOnce(pending.promise);
    census.write.mockResolvedValue(
      button === 'Evaluar UPC'
        ? { date, state: 'not_saved', reason: 'blocked', savedHere: false }
        : { date, state: 'local', cause: 'retrying', savedHere: true }
    );
    await act(async () => census.emit(empty()));
    await act(async () => screen.getByText(button).click());
    await waitFor(() => expect(screen.getByTestId('mutation').textContent).toBe('success'));
    await act(async () => {
      pending.reject(new Error('synthetic remote read failed'));
      await pending.promise.catch(() => {});
    });
    await waitFor(() => expect(census.shown()).toEqual({ value, confirmed: false }));
    expect(recoveredCount()).toBe(0);

    census.read.mockResolvedValue(confirmed('13', 'cambio de otro equipo'));
    census.reconnect();
    if (button === 'Evaluar UPC') {
      await waitFor(() =>
        expect(census.shown()).toEqual({ value: 'cambio de otro equipo', confirmed: true })
      );
    }
  }
);
