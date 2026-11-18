import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRayenImport } from '@/features/rayen-import/hooks/useRayenImport';
import * as diffApplication from '@/features/rayen-import/hooks/useRayenCensusDiffApplication';
import * as dailyRecordQuery from '@/hooks/useDailyRecordQuery';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import {
  getSessionGeneration,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { buildRecord } from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';

vi.mock('@/context/DailyRecordContext', () => ({ useDailyRecordData: () => ({ record: null }) }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { displayName: 'Operador sintético A' }, role: 'admin' }),
}));
vi.mock('@/features/rayen-import/hooks/useRayenImportMode', () => ({
  useRayenImportMode: () => ({
    policy: { mode: 'preview', revision: 1 },
    mode: 'preview',
    status: 'ready',
  }),
  resolveRayenPolicyBlockMessage: () => null,
}));
vi.mock('@/hooks/useStaffQuery', () => ({
  useNursesQuery: () => ({}),
  useTensQuery: () => ({}),
  useProfessionalsQuery: () => ({}),
  useSaveProfessionalsMutation: () => ({ mutate: vi.fn() }),
}));

/**
 * W14-RAY1 — the shipped useRayenImport adapter sends the census save with the session that began
 * the run, never the one current when the save starts (a save after a wait used to go out as B).
 */
const date = '2026-09-27';
const generationBefore = getSessionGeneration();
afterEach(() => {
  setSessionGeneration(generationBefore);
  vi.restoreAllMocks();
});

describe('useRayenImport → full census save', () => {
  it('forwards the run session even after the session changed', async () => {
    setSessionGeneration('synthetic-generation-A');
    const save = vi.fn();
    vi.spyOn(dailyRecordQuery, 'useSaveDailyRecordMutation').mockReturnValue({
      mutateAsync: save,
    } as never);
    const application = vi.spyOn(diffApplication, 'useRayenCensusDiffApplication');
    const client = new QueryClient();
    const container = createRepositoryContainer({
      dailyRecord: buildMockDailyRecordRepository(),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RepositoryProvider value={container}>{children}</RepositoryProvider>
      </QueryClientProvider>
    );
    const hook = renderHook(() => useRayenImport(date), { wrapper });
    const input = application.mock.calls.at(-1)![0];
    const runSession = input.ensureRun().authoringSession!;
    expect(runSession.generation).toBe('synthetic-generation-A');

    hook.unmount();
    setSessionGeneration('synthetic-generation-B');
    await input.saveDailyRecord(
      buildRecord(date),
      date,
      {} as never,
      buildRecord(date),
      runSession
    );

    expect(save.mock.calls[0][0].authoringSession).toEqual(runSession);
  });
});
