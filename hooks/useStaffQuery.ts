/**
 * useStaffQuery Hooks
 * TanStack Query wrappers for nursing and TENS catalogs.
 * Handles real-time synchronization and offline caching.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '../config/queryClient';
import { CatalogRepository } from '../services/repositories/DailyRecordRepository';
import { useAuthState } from './useAuthState';

/**
 * Hook to manage the list of nurses.
 * Integrates with CatalogRepository and provides real-time updates.
 */
export const useNursesQuery = () => {
    const queryClient = useQueryClient();
    const { isFirebaseConnected } = useAuthState();

    const query = useQuery({
        queryKey: [...queryKeys.staff.all, 'nurses'],
        queryFn: async () => {
            console.log('[useStaffQuery] 📥 Fetching nurses catalog...');
            return await CatalogRepository.getNurses();
        },
        staleTime: Infinity, // Staff catalog changes rarely, manual invalidation or subscription will handle it
    });

    // Real-time synchronization
    useEffect(() => {
        if (!isFirebaseConnected) return;

        console.log('[useStaffQuery] 📡 Subscribing to Nurses real-time catalog...');
        const unsubscribe = CatalogRepository.subscribeNurses((nurses) => {
            queryClient.setQueryData([...queryKeys.staff.all, 'nurses'], nurses);
        });

        return () => unsubscribe();
    }, [isFirebaseConnected, queryClient]);

    return query;
};

/**
 * Hook to manage the list of TENS.
 * Integrates with CatalogRepository and provides real-time updates.
 */
export const useTensQuery = () => {
    const queryClient = useQueryClient();
    const { isFirebaseConnected } = useAuthState();

    const query = useQuery({
        queryKey: [...queryKeys.staff.all, 'tens'],
        queryFn: async () => {
            console.log('[useStaffQuery] 📥 Fetching TENS catalog...');
            return await CatalogRepository.getTens();
        },
        staleTime: Infinity,
    });

    // Real-time synchronization
    useEffect(() => {
        if (!isFirebaseConnected) return;

        console.log('[useStaffQuery] 📡 Subscribing to TENS real-time catalog...');
        const unsubscribe = CatalogRepository.subscribeTens((tens) => {
            queryClient.setQueryData([...queryKeys.staff.all, 'tens'], tens);
        });

        return () => unsubscribe();
    }, [isFirebaseConnected, queryClient]);

    return query;
};

/**
 * Mutation to save the nurses catalog.
 */
export const useSaveNursesMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (nurses: string[]) => CatalogRepository.saveNurses(nurses),
        onMutate: async (newNurses) => {
            await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'nurses'] });
            const previousNurses = queryClient.getQueryData<string[]>([...queryKeys.staff.all, 'nurses']);
            queryClient.setQueryData([...queryKeys.staff.all, 'nurses'], newNurses);
            return { previousNurses };
        },
        onError: (err, newNurses, context) => {
            if (context?.previousNurses) {
                queryClient.setQueryData([...queryKeys.staff.all, 'nurses'], context.previousNurses);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: [...queryKeys.staff.all, 'nurses'] });
        },
    });
};

/**
 * Mutation to save the TENS catalog.
 */
export const useSaveTensMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (tens: string[]) => CatalogRepository.saveTens(tens),
        onMutate: async (newTens) => {
            await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'tens'] });
            const previousTens = queryClient.getQueryData<string[]>([...queryKeys.staff.all, 'tens']);
            queryClient.setQueryData([...queryKeys.staff.all, 'tens'], newTens);
            return { previousTens };
        },
        onError: (err, newTens, context) => {
            if (context?.previousTens) {
                queryClient.setQueryData([...queryKeys.staff.all, 'tens'], context.previousTens);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: [...queryKeys.staff.all, 'tens'] });
        },
    });
};
