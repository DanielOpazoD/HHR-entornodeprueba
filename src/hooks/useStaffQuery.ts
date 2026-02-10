import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '../config/queryClient';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { useAuthState } from './useAuthState';
import { ProfessionalCatalogItem } from '@/types';

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
            return await CatalogRepository.getNurses();
        },
        staleTime: Infinity,
    });

    useEffect(() => {
        if (!isFirebaseConnected) return;

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
            return await CatalogRepository.getTens();
        },
        staleTime: Infinity,
    });

    useEffect(() => {
        if (!isFirebaseConnected) return;

        const unsubscribe = CatalogRepository.subscribeTens((tens) => {
            queryClient.setQueryData([...queryKeys.staff.all, 'tens'], tens);
        });

        return () => unsubscribe();
    }, [isFirebaseConnected, queryClient]);

    return query;
};

/**
 * Hook to manage the list of professionals for On-Duty section.
 */
export const useProfessionalsQuery = () => {
    const queryClient = useQueryClient();
    const { isFirebaseConnected } = useAuthState();

    const query = useQuery({
        queryKey: [...queryKeys.staff.all, 'professionals'],
        queryFn: async () => {
            return await CatalogRepository.getProfessionals();
        },
        staleTime: Infinity,
    });

    useEffect(() => {
        if (!isFirebaseConnected) return;

        const unsubscribe = CatalogRepository.subscribeProfessionals((professionals) => {
            queryClient.setQueryData([...queryKeys.staff.all, 'professionals'], professionals);
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
        onError: (_err, _newNurses, context) => {
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
        onError: (_err, _newTens, context) => {
            if (context?.previousTens) {
                queryClient.setQueryData([...queryKeys.staff.all, 'tens'], context.previousTens);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: [...queryKeys.staff.all, 'tens'] });
        },
    });
};

/**
 * Mutation to save the professionals catalog.
 */
export const useSaveProfessionalsMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (professionals: ProfessionalCatalogItem[]) => CatalogRepository.saveProfessionals(professionals),
        onMutate: async (newProfessionals) => {
            await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'professionals'] });
            const previousProfessionals = queryClient.getQueryData<ProfessionalCatalogItem[]>([...queryKeys.staff.all, 'professionals']);
            queryClient.setQueryData([...queryKeys.staff.all, 'professionals'], newProfessionals);
            return { previousProfessionals };
        },
        onError: (_err, _newProfessionals, context) => {
            if (context?.previousProfessionals) {
                queryClient.setQueryData([...queryKeys.staff.all, 'professionals'], context.previousProfessionals);
            }
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: [...queryKeys.staff.all, 'professionals'] });
        },
    });
};
