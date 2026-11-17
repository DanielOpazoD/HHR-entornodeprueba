import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import * as freshness from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import { useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import {
  applyOptimisticDailyRecordPatch,
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { createDailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import { resolvePatchErrorFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';
import type {
  SaveDailyRecordResult,
  UpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import { authoredOptions, captureAuthoringSession } from '@/services/storage/authoringSession';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import * as writeService from '@/services/repositories/dailyRecordRepositoryWriteService';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  PARITY_DATE,
  baseDay,
  observeConsumers,
  readLocalDurability,
} from './dailyRecordWriteResultParity.test-support';
import {
  SERVER_CONFIRMED_AT,
  server,
  type ServerAnswer,
} from './dailyRecordWriteResultParityServer.test-support';

/** The edit the person typed, read from a record (the note by default). */
type Shown = (record: DailyRecord | null | undefined) => unknown;
const note: Shown = record => record?.handoffNovedadesNightShift;

const mountWith = (
  shown: DailyRecord | null,
  authoritative?: DailyRecord,
  beforeWrite?: () => unknown,
  respond?: () => UpdatePartialDailyRecordResult
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } },
  });
  if (shown) setDailyRecordQueryData(client, PARITY_DATE, shown);
  vi.spyOn(freshness, 'ensureFreshClinicalPatchMutation').mockResolvedValue(
    createDailyRecordQueryResult(shown, {
      serverConfirmed: true,
      date: PARITY_DATE,
      availabilityState: 'resolved',
      consistencyState: 'remote_authoritative',
      sourceOfTruth: 'remote',
      retryability: 'not_applicable',
      recoveryAction: 'none',
      conflictSummary: null,
      observabilityTags: ['daily_record', 'read'],
      repairApplied: false,
    })
  );
  vi.spyOn(freshness, 'ensureFreshDailyRecordSaveMutation').mockResolvedValue(undefined);
  // The shipped repository behind the port, as the app wires it.
  const repository = buildMockDailyRecordRepository();
  repository.updatePartialDetailed = async (date, patch, options) => {
    await beforeWrite?.();
    if (respond) return respond();
    return writeService.updatePartialDetailed(date, patch, authoredOptions(options ?? {}));
  };
  repository.saveDetailed = async (record, version, options) => {
    await beforeWrite?.();
    return writeService.saveDetailed(record, version, authoredOptions(options ?? {}));
  };
  vi.mocked(repository.getAuthoritativeForDate).mockResolvedValue(authoritative ?? null);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={createRepositoryContainer({ dailyRecord: repository })}>
        {children}
      </RepositoryProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
};

const classifyView = (
  client: QueryClient,
  shown: DailyRecord | null,
  edited: unknown,
  read: Shown
) => {
  const cached = client.getQueryData<{ record: DailyRecord | null }>(
    getDailyRecordQueryKey(PARITY_DATE)
  )?.record;
  if (!shown) return cached ? 'muestra un censo nuevo' : 'sin censo en pantalla';
  if (cached?.lastUpdated === SERVER_CONFIRMED_AT) return 'muestra la versión del servidor';
  if (read(cached) === edited) return 'conserva la edición';
  if (read(cached) === read(shown)) return 'vuelve al valor anterior';
  return `otro valor: ${String(read(cached))}`;
};

/**
 * Sends one edit through the mounted census mutation (usePatchDailyRecordMutation) and reports
 * the result, the error, what the census shows afterwards, and the sync box state.
 */
export type { Shown };

export const runPatchInHook = async (
  patch: DailyRecordPatch,
  options: Omit<PartialUpdateDailyRecordOptions, 'authoringSession'> = {},
  {
    read = note,
    authoritative,
    beforeWrite,
    respond,
  }: {
    read?: Shown;
    authoritative?: DailyRecord;
    beforeWrite?: () => unknown;
    /** A producer that today's hook flow cannot trigger, called in place of the repository. */
    respond?: () => UpdatePartialDailyRecordResult;
  } = {}
) => {
  onlineManager.setOnline(true);
  const shown = (await hospitalDB.dailyRecords.get(PARITY_DATE)) ?? null;
  const { client, wrapper } = mountWith(shown, authoritative, beforeWrite, respond);
  const hook = renderHook(() => usePatchDailyRecordMutation(PARITY_DATE), { wrapper });
  let result: UpdatePartialDailyRecordResult | null = null;
  let error: unknown;
  await act(async () => {
    try {
      result = (
        await hook.result.current.mutateAsync({
          date: PARITY_DATE,
          partial: patch,
          options: { ...options, authoringSession: captureAuthoringSession() },
        })
      ).result;
    } catch (caught) {
      error = caught;
    }
  });
  // The sync box once the mutation settled (the remote mutation re-renders after it resolves).
  await waitFor(() => {
    if (hook.result.current.isPending) throw new Error('mutation still pending');
  });
  const edited = shown ? read(applyOptimisticDailyRecordPatch(shown, patch)) : undefined;
  const view = {
    vista: classifyView(client, shown, edited, read),
    cuadro: resolveDailyRecordSyncStatus([hook.result.current]),
  };
  hook.unmount();
  client.clear();
  return { result: result as UpdatePartialDailyRecordResult | null, error, ...view };
};

/** The same for a whole-day save through useSaveDailyRecordMutation. */
export const runSaveInHook = async (
  record: DailyRecord,
  extra: { rayenStructuralWriteGuard?: boolean; requireConfirmedRecord?: boolean } = {},
  beforeWrite?: () => unknown
) => {
  onlineManager.setOnline(true);
  const shown = (await hospitalDB.dailyRecords.get(PARITY_DATE)) as DailyRecord;
  const { client, wrapper } = mountWith(shown, undefined, beforeWrite);
  const hook = renderHook(() => useSaveDailyRecordMutation(), { wrapper });
  let result: SaveDailyRecordResult | null = null;
  let error: unknown;
  await act(async () => {
    try {
      result = (
        await hook.result.current.mutateAsync({
          record,
          expectedLastUpdated: shown.lastUpdated,
          baseRecord: shown,
          authoringSession: captureAuthoringSession(),
          ...extra,
        })
      ).result;
    } catch (caught) {
      error = caught;
    }
  });
  await waitFor(() => {
    if (hook.result.current.isPending) throw new Error('mutation still pending');
  });
  const view = {
    vista: classifyView(client, shown, note(record), note),
    cuadro: resolveDailyRecordSyncStatus([hook.result.current]),
  };
  hook.unmount();
  client.clear();
  return { result: result as SaveDailyRecordResult | null, error, ...view };
};

/** One row of a parity table: how today's code produces the shape, and what each consumer does. */
export interface ParityCase {
  /** Producer: file:line where today's code builds this shape. */
  from: string;
  answer?: ServerAnswer;
  patch?: DailyRecordPatch;
  options?: Omit<PartialUpdateDailyRecordOptions, 'authoringSession'>;
  arrange?: () => unknown;
  beforeWrite?: () => unknown;
  /** What the person edited, read from the census (the night note by default). */
  read?: Shown;
  authoritative?: () => DailyRecord;
  respond?: () => UpdatePartialDailyRecordResult;
  expected: Record<string, unknown>;
}

export const describeThrown = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Runs a census edit through the mounted hook and collects every consumer's answer. */
export const observePatchCase = async (testCase: ParityCase) => {
  if (testCase.answer) server.answer = testCase.answer;
  await testCase.arrange?.();
  const run = await runPatchInHook(
    testCase.patch ?? { handoffNovedadesNightShift: 'NOTA SINTETICA A' },
    testCase.options,
    {
      beforeWrite: testCase.beforeWrite,
      read: testCase.read,
      authoritative: testCase.authoritative?.(),
      respond: testCase.respond,
    }
  );
  const durability = await readLocalDurability();
  if (!run.result) {
    // The mutation rejected: useDailyRecordSyncQuery.ts:281 shows this error notice.
    const feedback = resolvePatchErrorFeedback(run.error);
    return {
      vista: run.vista,
      cuadro: run.cuadro,
      lanza: describeThrown(run.error),
      aviso: `${feedback.title}: ${feedback.message}`,
      ...durability,
    };
  }
  return {
    vista: run.vista,
    cuadro: run.cuadro,
    ...(await observeConsumers(
      run.result,
      (await hospitalDB.dailyRecords.get(PARITY_DATE)) ?? baseDay()
    )),
    ...durability,
  };
};
