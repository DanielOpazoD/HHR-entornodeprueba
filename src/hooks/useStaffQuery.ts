import {
  CatalogConflictError,
  diffCatalog,
  catalogChangesAccepted,
  exactStaffName,
  professionalCatalogIdentity,
  type SavedStaffCatalog,
} from '@/services/repositories/contracts/catalogChanges';
import { replaceEqualDeep, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { queryKeys } from '../config/queryClient';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import { useAuth } from '@/context/AuthContext';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import { useEloisaStaff } from './useEloisaStaff';
import {
  mergeStaffCatalog,
  savedTextsOfRow,
  staffCatalogRows,
  type EloisaStaffIdentity,
  type NursingRole,
} from '@/services/staff/eloisaStaffIdentity';
import {
  CatalogRemoteSyncError,
  isCatalogExampleList,
  normalizeStringCatalog,
  normalizeProfessionalCatalog,
} from '@/services/repositories/contracts/catalogContracts';

type CatalogEdit<T> = T[] | { next: T[]; base: T[] };
const catalogNext = <T>(edit: CatalogEdit<T>): T[] => (Array.isArray(edit) ? edit : edit.next);

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

// Sharing structure with a list of examples would make it look like a saved list, or the reverse.
const keepExampleProvenance = (previous: unknown, next: unknown): unknown =>
  isCatalogExampleList(previous) || isCatalogExampleList(next)
    ? next
    : replaceEqualDeep(previous, next);

/** The last confirmed saved list: examples are not saved names and a failed read is unknown. */
const savedStaffNames = (data: string[] | undefined): string[] | undefined =>
  data === undefined ? undefined : isCatalogExampleList(data) ? [] : data;

/** What the screen shows and, for each shown row, the saved texts it stands for. */
const useStaffCatalogView = (
  data: string[] | undefined,
  discovered: EloisaStaffIdentity[],
  role: NursingRole
) =>
  useMemo(() => {
    const list = savedStaffNames(data);
    const saved: SavedStaffCatalog | undefined = list && {
      list,
      textsOf: savedTextsOfRow(staffCatalogRows(list, discovered, role)),
    };
    return { data: mergeStaffCatalog(data ?? [], discovered, role), saved };
  }, [data, discovered, role]);

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
    structuralSharing: keepExampleProvenance,
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

  const view = useStaffCatalogView(query.data, discovered, 'nurse');
  return {
    ...query,
    manualData: query.data,
    identities: discovered,
    ...view,
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
    structuralSharing: keepExampleProvenance,
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

  const view = useStaffCatalogView(query.data, discovered, 'tens');
  return {
    ...query,
    manualData: query.data,
    ...view,
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

const catalogEditAccepted = <T extends string | ProfessionalCatalogItem>(
  edit: CatalogEdit<T>,
  current: unknown,
  normalize: (value: unknown) => T[],
  key: (item: T) => string
): boolean => {
  if (current === undefined) return false;
  const accepted = normalize(current);
  const next = normalize(catalogNext(edit));
  if (Array.isArray(edit)) return JSON.stringify(accepted) === JSON.stringify(next);
  return catalogChangesAccepted(accepted, diffCatalog(normalize(edit.base), next, key), key);
};

const useAcceptedCatalogChange = <T>(
  key: string,
  mutation: { error: unknown; variables?: T; reset: () => void },
  isAccepted: (value: T, current: unknown) => boolean
) => {
  const client = useQueryClient();
  const { error, variables, reset } = mutation;
  useEffect(() => {
    if (!(error instanceof CatalogRemoteSyncError) || variables === undefined) return;
    const reconcile = () => {
      const accepted = client.getQueryData([...queryKeys.staff.all, key]);
      if (isAccepted(variables, accepted)) reset();
    };
    const unsubscribe = client.getQueryCache().subscribe(reconcile);
    reconcile();
    return unsubscribe;
  }, [client, key, error, variables, reset, isAccepted]);
  return mutation;
};

/**
 * Mutation to save the nurses catalog.
 */
export const useSaveNursesMutation = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (edit: CatalogEdit<string>) => {
      const base = Array.isArray(edit)
        ? savedStaffNames(queryClient.getQueryData<string[]>([...queryKeys.staff.all, 'nurses']))
        : edit.base;
      if (base === undefined) throw new CatalogReadUnavailableError();
      return CatalogRepository.saveNurses(catalogNext(edit), base);
    },
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData([...queryKeys.staff.all, 'nurses']) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'nurses'] });
    },
    onSuccess: (result, edit) => {
      queryClient.setQueryData(
        [...queryKeys.staff.all, 'nurses'],
        normalizeStringCatalog(result ?? catalogNext(edit))
      );
    },
    onError: error => {
      if (error instanceof CatalogConflictError) {
        queryClient.setQueryData(
          [...queryKeys.staff.all, 'nurses'],
          normalizeStringCatalog(error.current)
        );
      }
    },
  });
  useAcceptedCatalogChange('nurses', mutation, (edit: CatalogEdit<string>, current: unknown) =>
    catalogEditAccepted(edit, current, normalizeStringCatalog, exactStaffName)
  );
  return mutation;
};

/**
 * Mutation to save the TENS catalog.
 */
export const useSaveTensMutation = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (edit: CatalogEdit<string>) => {
      const base = Array.isArray(edit)
        ? savedStaffNames(queryClient.getQueryData<string[]>([...queryKeys.staff.all, 'tens']))
        : edit.base;
      if (base === undefined) throw new CatalogReadUnavailableError();
      return CatalogRepository.saveTens(catalogNext(edit), base);
    },
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData([...queryKeys.staff.all, 'tens']) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'tens'] });
    },
    onSuccess: (result, edit) => {
      queryClient.setQueryData(
        [...queryKeys.staff.all, 'tens'],
        normalizeStringCatalog(result ?? catalogNext(edit))
      );
    },
    onError: error => {
      if (error instanceof CatalogConflictError) {
        queryClient.setQueryData(
          [...queryKeys.staff.all, 'tens'],
          normalizeStringCatalog(error.current)
        );
      }
    },
  });
  useAcceptedCatalogChange('tens', mutation, (edit: CatalogEdit<string>, current: unknown) =>
    catalogEditAccepted(edit, current, normalizeStringCatalog, exactStaffName)
  );
  return mutation;
};

/**
 * Mutation to save the professionals catalog.
 */
export const useSaveProfessionalsMutation = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (edit: CatalogEdit<ProfessionalCatalogItem>) => {
      const base = Array.isArray(edit)
        ? queryClient.getQueryData<ProfessionalCatalogItem[]>([
            ...queryKeys.staff.all,
            'professionals',
          ])
        : edit.base;
      if (base === undefined) throw new CatalogReadUnavailableError();
      return CatalogRepository.saveProfessionals(catalogNext(edit), base);
    },
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData([...queryKeys.staff.all, 'professionals']) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: [...queryKeys.staff.all, 'professionals'] });
    },
    onSuccess: (result, edit) => {
      queryClient.setQueryData(
        [...queryKeys.staff.all, 'professionals'],
        normalizeProfessionalCatalog(result ?? catalogNext(edit))
      );
    },
    onError: error => {
      if (error instanceof CatalogConflictError) {
        queryClient.setQueryData(
          [...queryKeys.staff.all, 'professionals'],
          normalizeProfessionalCatalog(error.current)
        );
      }
    },
  });
  useAcceptedCatalogChange(
    'professionals',
    mutation,
    (edit: CatalogEdit<ProfessionalCatalogItem>, current: unknown) =>
      catalogEditAccepted(edit, current, normalizeProfessionalCatalog, professionalCatalogIdentity)
  );
  return mutation;
};
