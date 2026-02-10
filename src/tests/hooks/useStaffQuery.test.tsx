import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
    useNursesQuery,
    useTensQuery,
    useProfessionalsQuery,
    useSaveNursesMutation,
    useSaveTensMutation,
    useSaveProfessionalsMutation
} from '@/hooks/useStaffQuery';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { useAuthState } from '@/hooks/useAuthState';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock dependencies
vi.mock('@/services/repositories/CatalogRepository');
vi.mock('@/hooks/useAuthState');

const createTestQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: { retry: false },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={createTestQueryClient()} >
        {children}
    </QueryClientProvider>
);

describe('useStaffQuery Hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAuthState).mockReturnValue({ isFirebaseConnected: true } as any);
    });

    describe('Queries', () => {
        it('useNursesQuery should fetch nurses and subscribe', async () => {
            const mockNurses = ['Nurse 1', 'Nurse 2'];
            const subscribeMock = vi.fn(() => vi.fn());
            vi.mocked(CatalogRepository.getNurses).mockResolvedValue(mockNurses);
            vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(subscribeMock as any);

            const { result } = renderHook(() => useNursesQuery(), { wrapper });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual(mockNurses);
            expect(subscribeMock).toHaveBeenCalled();
        });

        it('useTensQuery should fetch tens and subscribe', async () => {
            const mockTens = ['TENS 1', 'TENS 2'];
            const subscribeMock = vi.fn(() => vi.fn());
            vi.mocked(CatalogRepository.getTens).mockResolvedValue(mockTens);
            vi.mocked(CatalogRepository.subscribeTens).mockImplementation(subscribeMock as any);

            const { result } = renderHook(() => useTensQuery(), { wrapper });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual(mockTens);
            expect(subscribeMock).toHaveBeenCalled();
        });

        it('useProfessionalsQuery should fetch professionals and subscribe', async () => {
            const mockProfs = [{ name: 'Dr. Smith', phone: '123', specialty: 'Medicina Interna' }];
            const subscribeMock = vi.fn(() => vi.fn());
            vi.mocked(CatalogRepository.getProfessionals).mockResolvedValue(mockProfs as any);
            vi.mocked(CatalogRepository.subscribeProfessionals).mockImplementation(subscribeMock as any);

            const { result } = renderHook(() => useProfessionalsQuery(), { wrapper });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual(mockProfs);
            expect(subscribeMock).toHaveBeenCalled();
        });

        it('should not subscribe if firebase is not connected', async () => {
            vi.mocked(useAuthState).mockReturnValue({ isFirebaseConnected: false } as any);
            const subscribeMock = vi.fn();
            vi.mocked(CatalogRepository.subscribeNurses).mockImplementation(subscribeMock as any);

            renderHook(() => useNursesQuery(), { wrapper });

            expect(subscribeMock).not.toHaveBeenCalled();
        });
    });

    describe('Mutations', () => {
        it('useSaveNursesMutation should call repository and invalidate queries', async () => {
            const saveMock = vi.mocked(CatalogRepository.saveNurses).mockResolvedValue(undefined);
            const { result } = renderHook(() => useSaveNursesMutation(), { wrapper });

            await result.current.mutateAsync(['New Nurse']);

            expect(saveMock).toHaveBeenCalledWith(['New Nurse']);
        });

        it('useSaveTensMutation should call repository', async () => {
            const saveMock = vi.mocked(CatalogRepository.saveTens).mockResolvedValue(undefined);
            const { result } = renderHook(() => useSaveTensMutation(), { wrapper });

            await result.current.mutateAsync(['New TENS']);

            expect(saveMock).toHaveBeenCalledWith(['New TENS']);
        });

        it('useSaveProfessionalsMutation should call repository', async () => {
            const mockProfs = [{ name: 'New Prof', phone: '456', specialty: 'Cirugía' }];
            const saveMock = vi.mocked(CatalogRepository.saveProfessionals).mockResolvedValue(undefined);
            const { result } = renderHook(() => useSaveProfessionalsMutation(), { wrapper });

            await result.current.mutateAsync(mockProfs as any);

            expect(saveMock).toHaveBeenCalledWith(mockProfs);
        });

        it('useSaveNursesMutation should perform optimistic update and rollback on error', async () => {
            const queryClient = createTestQueryClient();
            const localWrapper = ({ children }: { children: React.ReactNode }) => (
                <QueryClientProvider client={queryClient}>
                    {children}
                </QueryClientProvider>
            );

            const initialNurses = ['Old Nurse'];
            const newNurses = ['New Nurse'];
            queryClient.setQueryData([...['staff'], 'nurses'], initialNurses);

            vi.mocked(CatalogRepository.saveNurses).mockRejectedValue(new Error('Save failed'));

            const { result } = renderHook(() => useSaveNursesMutation(), { wrapper: localWrapper });

            try {
                await result.current.mutateAsync(newNurses);
            } catch (e) {
                // Expected error
            }

            // Should be back to initial after error
            expect(queryClient.getQueryData([...['staff'], 'nurses'])).toEqual(initialNurses);
        });
    });
});
