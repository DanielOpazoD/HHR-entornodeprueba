import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '../config/queryClient';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { useAuth } from '@/context/AuthContext';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { useEloisaStaff } from './useEloisaStaff';
import { mergeStaffCatalog } from '@/services/staff/eloisaStaffIdentity';
import {
  normalizeStringCatalog,
  normalizeProfessionalCatalog,
} from '@/services/repositories/contracts/catalogContracts';

const useCatalogRealtimeReady = (): boolean => {
  const { remoteSyncStatus } = useAuth();
  return remoteSyncStatus === 'ready';
};

export class CatalogReadUnavailableError extends Error {
  constructor() {
    super(
      'No se pudo leer la lista. Lo escrito no se guardó. Pulse Reintentar para leerla y luego vuelva a guardar.'
    );
  }
}

const STAFF_CATALOG_STALE_TIME_MS = 30_000;

/**
 * Hook to manage the list of nurses.
 * Integrates with CatalogRepository and provides real-time updates.
 */
export const useNursesQuery = () => {
  const queryClient = useQueryClient();
  const isCatalogRealtimeReady = useCatalogRealtimeReady();
  const discovered = useEloisaStaff(isCatalogRealtimeReady);
  const previousRealtimeReadyRef = useRef(isCatalogRealtimeReady);

  const query = useQuery({
    queryKey: [...queryKeys.staff.all, 'nurses'],
    queryFn: async () => {
      return await CatalogRepository.getNurses();
    },
    staleTime: STAFF_CATALOG_STALE_TIME_MS,
  });

  useEffect(() => {
    const didBecomeRealtimeReady = !previousRealtimeReadyRef.current && isCatalogRealtimeReady;
    previousRealtimeReadyRef.current = isCatalogRealtimeReady;

    if (!didBecomeRealtimeReady) {
      return;
    }

    void query.refetch();
  }, [isCatalogRealtimeReady, query]);

  useEffect(() => {
    if (!isCatalogRealtimeReady) return;

    const unsubscribe = CatalogRepository.subscribeNurses(nurses => {
      queryClient.setQueryData([...queryKeys.staff.all, 'nurses'], nurses);
    });

    return () => unsubscribe();
  }, [isCatalogRealtimeReady, queryClient]);

  const data = useMemo(
    () => mergeStaffCatalog(query.data ?? [], discovered, 'nurse'),
    [query.data, discovered]
  );
  return {
    ...query,
    manualData: query.data,
    identities: discovered,
    data,
  };
};

/**
 * Hook to manage the list of TENS.
 * Integrates with CatalogRepository and provides real-time updates.
 */
export const useTensQuery = () => {
  const queryClient = useQueryClient();
  const isCatalogRealtimeReady = useCatalogRealtimeReady();
  const discovered = useEloisaStaff(isCatalogRealtimeReady);
  const previousRealtimeReadyRef = useRef(isCatalogRealtimeReady);

  const query = useQuery({
    queryKey: [...queryKeys.staff.all, 'tens'],
    queryFn: async () => {
      return await CatalogRepository.getTens();
    },
    staleTime: STAFF_CATALOG_STALE_TIME_MS,
  });

  useEffect(() => {
    const didBecomeRealtimeReady = !previousRealtimeReadyRef.current && isCatalogRealtimeReady;
    previousRealtimeReadyRef.current = isCatalogRealtimeReady;

    if (!didBecomeRealtimeReady) {
      return;
    }

    void query.refetch();
  }, [isCatalogRealtimeReady, query]);

  useEffect(() => {
    if (!isCatalogRealtimeReady) return;

    const unsubscribe = CatalogRepository.subscribeTens(tens => {
      queryClient.setQueryData([...queryKeys.staff.all, 'tens'], tens);
    });

    return () => unsubscribe();
  }, [isCatalogRealtimeReady, queryClient]);

  const data = useMemo(
    () => mergeStaffCatalog(query.data ?? [], discovered, 'tens'),
    [query.data, discovered]
  );
  return {
    ...query,
    manualData: query.data,
    data,
  };
};

/**
 * Hook to manage the list of professionals for On-Duty section.
 */
export const useProfessionalsQuery = () => {
  const queryClient = useQueryClient();
  const isCatalogRealtimeReady = useCatalogRealtimeReady();
  const previousRealtimeReadyRef = useRef(isCatalogRealtimeReady);

  const query = useQuery({
    queryKey: [...queryKeys.staff.all, 'professionals'],
    queryFn: async () => {
      return await CatalogRepository.getProfessionals();
    },
    staleTime: STAFF_CATALOG_STALE_TIME_MS,
  });

  useEffect(() => {
    const didBecomeRealtimeReady = !previousRealtimeReadyRef.current && isCatalogRealtimeReady;
    previousRealtimeReadyRef.current = isCatalogRealtimeReady;

    if (!didBecomeRealtimeReady) {
      return;
    }

    void query.refetch();
  }, [isCatalogRealtimeReady, query]);

  useEffect(() => {
    if (!isCatalogRealtimeReady) return;

    const unsubscribe = CatalogRepository.subscribeProfessionals(professionals => {
      queryClient.setQueryData([...queryKeys.staff.all, 'professionals'], professionals);
    });

    return () => unsubscribe();
  }, [isCatalogRealtimeReady, queryClient]);

  return query;
};

/**
 * Mutation to save the nurses catalog.
 */
export const useSaveNursesMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (nurses: string[]) => CatalogRepository.saveNurses(nurses),
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData([...queryKeys.staff.all, 'nurses']) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'nurses'] });
    },
    onSuccess: (_result, names) => {
      queryClient.setQueryData([...queryKeys.staff.all, 'nurses'], normalizeStringCatalog(names));
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
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData([...queryKeys.staff.all, 'tens']) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'tens'] });
    },
    onSuccess: (_result, names) => {
      queryClient.setQueryData([...queryKeys.staff.all, 'tens'], normalizeStringCatalog(names));
    },
  });
};

/**
 * Mutation to save the professionals catalog.
 */
export const useSaveProfessionalsMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (professionals: ProfessionalCatalogItem[]) =>
      CatalogRepository.saveProfessionals(professionals),
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData([...queryKeys.staff.all, 'professionals']) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'professionals'] });
    },
    onSuccess: (_result, names) => {
      queryClient.setQueryData(
        [...queryKeys.staff.all, 'professionals'],
        normalizeProfessionalCatalog(names)
      );
    },
  });
};
