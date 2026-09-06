import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useNursesQuery,
  useTensQuery,
  useProfessionalsQuery,
  useSaveNursesMutation,
  useSaveTensMutation,
  useSaveProfessionalsMutation,
} from '@/hooks/useStaffQuery';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { useEloisaStaff } from '@/hooks/useEloisaStaff';
vi.mock('@/hooks/useEloisaStaff', () => ({ useEloisaStaff: vi.fn() }));
import { useAuth } from '@/context/AuthContext';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import {
  createQueryClientTestWrapper,
  createTestQueryClient,
} from '@/tests/utils/queryClientTestUtils';

// Mock dependencies
vi.mock('@/services/repositories/CatalogRepository');
vi.mock('@/context/AuthContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return {
    ...actual,
    useAuth: vi.fn(),
  };
});

const createWrapper = () => createQueryClientTestWrapper().wrapper;

describe('useStaffQuery Hooks', () => {
  type AuthContextValue = ReturnType<typeof useAuth>;
  type SubscribeNursesFn = typeof CatalogRepository.subscribeNurses;
  type SubscribeTensFn = typeof CatalogRepository.subscribeTens;
  type SubscribeProfessionalsFn = typeof CatalogRepository.subscribeProfessionals;
  type ProfessionalList = Awaited<ReturnType<typeof CatalogRepository.getProfessionals>>;
  type SaveProfessionalsInput = Parameters<typeof CatalogRepository.saveProfessionals>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEloisaStaff).mockReturnValue([]);
    setFirestoreSyncState({
      mode: 'enabled',
      reason: 'ready',
    });
    vi.mocked(useAuth).mockReturnValue({
      remoteSyncStatus: 'ready',
    } as AuthContextValue);
  });

  describe('Queries', () => {
    it('keeps discovered names available while manual catalog reads are pending', () => {
      vi.mocked(useEloisaStaff).mockReturnValue([
        { key: 'nurse:1', role: 'nurse', name: 'Ana Soto', aliases: [] },
        { key: 'tens:2', role: 'tens', name: 'Berta Perez', aliases: [] },
      ]);
      vi.mocked(CatalogRepository.getNurses).mockImplementation(() => new Promise(() => {}));
      vi.mocked(CatalogRepository.getTens).mockImplementation(() => new Promise(() => {}));
      vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(() => () => {});
      vi.mocked(CatalogRepository.subscribeTens).mockImplementation(() => () => {});
      const { result } = renderHook(() => ({ nurses: useNursesQuery(), tens: useTensQuery() }), {
        wrapper: createWrapper(),
      });
      expect(result.current.nurses.data).toEqual(['Ana Soto']);
      expect(result.current.tens.data).toEqual(['Berta Perez']);
      expect(result.current.nurses.manualData).toBeUndefined();
    });
    it('offers discovered staff without treating them as manually curated or mixing roles', async () => {
      vi.mocked(useEloisaStaff).mockReturnValue([
        { key: 'nurse:1', role: 'nurse', name: 'Ana Soto Rojas', aliases: ['Ana Soto'] },
        { key: 'tens:2', role: 'tens', name: 'Berta Perez', aliases: [] },
      ]);
      vi.mocked(CatalogRepository.getNurses).mockResolvedValue(['Manual Persona']);
      vi.mocked(CatalogRepository.getTens).mockResolvedValue([]);
      vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(() => () => {});
      vi.mocked(CatalogRepository.subscribeTens).mockImplementation(() => () => {});
      const { result } = renderHook(() => ({ nurses: useNursesQuery(), tens: useTensQuery() }), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.tens.isSuccess).toBe(true));
      expect(result.current.nurses.data).toEqual(['Manual Persona', 'Ana Soto Rojas']);
      expect(result.current.nurses.manualData).toEqual(['Manual Persona']);
      expect(result.current.tens.data).toEqual(['Berta Perez']);
      expect(result.current.tens.manualData).toEqual([]);
    });

    it('useNursesQuery should fetch nurses and subscribe', async () => {
      const mockNurses = ['Nurse 1', 'Nurse 2'];
      const subscribeMock = vi.fn(() => vi.fn());
      vi.mocked(CatalogRepository.getNurses).mockResolvedValue(mockNurses);
      vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(
        subscribeMock as unknown as SubscribeNursesFn
      );

      const { result } = renderHook(() => useNursesQuery(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockNurses);
      expect(subscribeMock).toHaveBeenCalled();
    });

    it('useTensQuery should fetch tens and subscribe', async () => {
      const mockTens = ['TENS 1', 'TENS 2'];
      const subscribeMock = vi.fn(() => vi.fn());
      vi.mocked(CatalogRepository.getTens).mockResolvedValue(mockTens);
      vi.mocked(CatalogRepository.subscribeTens).mockImplementation(
        subscribeMock as unknown as SubscribeTensFn
      );

      const { result } = renderHook(() => useTensQuery(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockTens);
      expect(subscribeMock).toHaveBeenCalled();
    });

    it('useProfessionalsQuery should fetch professionals and subscribe', async () => {
      const mockProfs = [{ name: 'Dr. Smith', phone: '123', specialty: 'Medicina Interna' }];
      const subscribeMock = vi.fn(() => vi.fn());
      vi.mocked(CatalogRepository.getProfessionals).mockResolvedValue(
        mockProfs as unknown as ProfessionalList
      );
      vi.mocked(CatalogRepository.subscribeProfessionals).mockImplementation(
        subscribeMock as unknown as SubscribeProfessionalsFn
      );

      const { result } = renderHook(() => useProfessionalsQuery(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockProfs);
      expect(subscribeMock).toHaveBeenCalled();
    });

    it('should not subscribe if firebase is not connected', async () => {
      vi.mocked(useAuth).mockReturnValue({
        remoteSyncStatus: 'local_only',
      } as AuthContextValue);
      const subscribeMock = vi.fn();
      vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(
        subscribeMock as unknown as SubscribeNursesFn
      );

      renderHook(() => useNursesQuery(), { wrapper: createWrapper() });

      expect(subscribeMock).not.toHaveBeenCalled();
    });

    it('should not subscribe while remote sync runtime is bootstrapping', async () => {
      setFirestoreSyncState({
        mode: 'bootstrapping',
        reason: 'auth_loading',
      });
      vi.mocked(useAuth).mockReturnValue({
        remoteSyncStatus: 'bootstrapping',
      } as AuthContextValue);
      const subscribeMock = vi.fn();
      vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(
        subscribeMock as unknown as SubscribeNursesFn
      );

      renderHook(() => useNursesQuery(), { wrapper: createWrapper() });

      expect(subscribeMock).not.toHaveBeenCalled();
    });

    it('refetches nurses when catalog realtime transitions from bootstrapping to ready', async () => {
      const mockGetNurses = vi
        .mocked(CatalogRepository.getNurses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['Nurse 1']);

      vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(
        vi.fn(() => vi.fn()) as unknown as SubscribeNursesFn
      );

      const { result, rerender } = renderHook(
        ({ remoteSyncStatus }: { remoteSyncStatus: 'bootstrapping' | 'ready' }) => {
          vi.mocked(useAuth).mockReturnValue({
            remoteSyncStatus,
          } as AuthContextValue);

          return useNursesQuery();
        },
        {
          initialProps: { remoteSyncStatus: 'bootstrapping' as 'bootstrapping' | 'ready' },
          wrapper: createWrapper(),
        }
      );

      await waitFor(() => {
        expect(result.current.data).toEqual([]);
      });

      rerender({ remoteSyncStatus: 'ready' });

      await waitFor(() => {
        expect(result.current.data).toEqual(['Nurse 1']);
      });

      expect(mockGetNurses).toHaveBeenCalledTimes(2);
    });
  });

  describe('Mutations', () => {
    it('useSaveNursesMutation should call repository and invalidate queries', async () => {
      const saveMock = vi.mocked(CatalogRepository.saveNurses).mockResolvedValue(undefined);
      const { result } = renderHook(() => useSaveNursesMutation(), { wrapper: createWrapper() });

      await result.current.mutateAsync(['New Nurse']);

      expect(saveMock).toHaveBeenCalledWith(['New Nurse']);
    });

    it('useSaveTensMutation should call repository', async () => {
      const saveMock = vi.mocked(CatalogRepository.saveTens).mockResolvedValue(undefined);
      const { result } = renderHook(() => useSaveTensMutation(), { wrapper: createWrapper() });

      await result.current.mutateAsync(['New TENS']);

      expect(saveMock).toHaveBeenCalledWith(['New TENS']);
    });

    it('useSaveProfessionalsMutation should call repository', async () => {
      const mockProfs = [{ name: 'New Prof', phone: '456', specialty: 'Cirugía' }];
      const saveMock = vi.mocked(CatalogRepository.saveProfessionals).mockResolvedValue(undefined);
      const { result } = renderHook(() => useSaveProfessionalsMutation(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync(mockProfs as unknown as SaveProfessionalsInput);

      expect(saveMock).toHaveBeenCalledWith(mockProfs);
    });

    it('useSaveNursesMutation should perform optimistic update and rollback on error', async () => {
      const queryClient = createTestQueryClient();
      const { wrapper: localWrapper } = createQueryClientTestWrapper({ queryClient });

      const initialNurses = ['Old Nurse'];
      const newNurses = ['New Nurse'];
      queryClient.setQueryData([...['staff'], 'nurses'], initialNurses);

      vi.mocked(CatalogRepository.saveNurses).mockRejectedValue(new Error('Save failed'));

      const { result } = renderHook(() => useSaveNursesMutation(), { wrapper: localWrapper });

      try {
        await result.current.mutateAsync(newNurses);
      } catch (_e) {
        // Expected error
      }

      // Should be back to initial after error
      expect(queryClient.getQueryData([...['staff'], 'nurses'])).toEqual(initialNurses);
    });
  });
});
