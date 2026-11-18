import { nurseIdentityKey } from '@/services/staff/nurseIdentity';
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

const catalogEditAccepted = <T extends string | ProfessionalCatalogItem>(
  edit: CatalogEdit<T>,
  current: unknown,
  normalize: (value: unknown) => T[],
  key: (item: T) => string,
  additionKey = key
): boolean => {
  if (current === undefined) return false;
  const accepted = normalize(current);
  const next = normalize(catalogNext(edit));
  if (Array.isArray(edit)) return JSON.stringify(accepted) === JSON.stringify(next);
  // Additions may be deduplicated by person; deliberate respellings and removals still
  // require the exact saved text, so an unchanged spelling cannot confirm a correction.
  return diffCatalog(normalize(edit.base), next, key).every(change =>
    catalogChangesAccepted(accepted, [change], change.kind === 'add' ? additionKey : key)
  );
};

/**
 * One saved catalog: where it is read, followed and saved, and what differs between catalogs.
 * The hooks below read and save every catalog the same way from these values.
 */
interface CatalogSource<T> {
  /** The last part of the query key, which is also the catalog's name in the cache. */
  key: 'nurses' | 'tens' | 'professionals';
  read: () => Promise<T[]>;
  follow: (onList: (list: T[]) => void) => () => void;
  save: (next: T[], base: T[]) => Promise<T[] | void>;
  normalize: (value: unknown) => T[];
  /** The confirmed list a whole-list save replaces; undefined when it was never read. */
  savedBase: (data: T[] | undefined) => T[] | undefined;
  /** Whether the accepted list already holds the edit, so a lost answer is not an error. */
  isAccepted: (edit: CatalogEdit<T>, current: unknown) => boolean;
  structuralSharing: boolean | ((previous: unknown, next: unknown) => unknown);
}

const staffNamesAccepted = (edit: CatalogEdit<string>, current: unknown): boolean =>
  catalogEditAccepted(edit, current, normalizeStringCatalog, exactStaffName, nurseIdentityKey);

// Nurses and TENS differ only in where their list lives; names follow the same identity rules.
const STAFF_CATALOGS: Record<NursingRole, CatalogSource<string>> = {
  nurse: {
    key: 'nurses',
    read: () => CatalogRepository.getNurses(),
    follow: onList => CatalogRepository.subscribeNurses(onList),
    save: (next, base) => CatalogRepository.saveNurses(next, base),
    normalize: normalizeStringCatalog,
    savedBase: savedStaffNames,
    isAccepted: staffNamesAccepted,
    structuralSharing: keepExampleProvenance,
  },
  tens: {
    key: 'tens',
    read: () => CatalogRepository.getTens(),
    follow: onList => CatalogRepository.subscribeTens(onList),
    save: (next, base) => CatalogRepository.saveTens(next, base),
    normalize: normalizeStringCatalog,
    savedBase: savedStaffNames,
    isAccepted: staffNamesAccepted,
    structuralSharing: keepExampleProvenance,
  },
};

const PROFESSIONALS_CATALOG: CatalogSource<ProfessionalCatalogItem> = {
  key: 'professionals',
  read: () => CatalogRepository.getProfessionals(),
  follow: onList => CatalogRepository.subscribeProfessionals(onList),
  save: (next, base) => CatalogRepository.saveProfessionals(next, base),
  normalize: normalizeProfessionalCatalog,
  savedBase: data => data,
  isAccepted: (edit, current) =>
    catalogEditAccepted(edit, current, normalizeProfessionalCatalog, professionalCatalogIdentity),
  structuralSharing: true,
};

const catalogQueryKey = (key: CatalogSource<unknown>['key']) => [...queryKeys.staff.all, key];

/** Reads a catalog, reads it again when sync becomes ready and then follows it live. */
const useCatalogQuery = <T>(source: CatalogSource<T>, isCatalogRealtimeReady: boolean) => {
  const queryClient = useQueryClient();
  const previousRealtimeReadyRef = useRef(isCatalogRealtimeReady);

  const query = useQuery({
    queryKey: catalogQueryKey(source.key),
    queryFn: async () => {
      return await source.read();
    },
    staleTime: STAFF_CATALOG_STALE_TIME_MS,
    structuralSharing: source.structuralSharing,
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

    const unsubscribe = source.follow(list => {
      queryClient.setQueryData(catalogQueryKey(source.key), list);
    });

    return () => unsubscribe();
  }, [isCatalogRealtimeReady, queryClient, source]);

  return query;
};

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

/** A nursing role's saved names joined with the staff Eloísa reports for that role. */
const useStaffNamesQuery = (role: NursingRole) => {
  const isCatalogRealtimeReady = useCatalogRealtimeReady();
  const discovered = useEloisaStaff(isCatalogRealtimeReady);
  const query = useCatalogQuery(STAFF_CATALOGS[role], isCatalogRealtimeReady);
  const view = useStaffCatalogView(query.data, discovered, role);
  return {
    ...query,
    manualData: query.data,
    identities: discovered,
    ...view,
  };
};

/** The list of nurses, kept current in real time. */
export const useNursesQuery = () => useStaffNamesQuery('nurse');

/** The list of TENS, kept current in real time. */
export const useTensQuery = () => useStaffNamesQuery('tens');

/** The list of professionals for the On-Duty section. */
export const useProfessionalsQuery = () => {
  const isCatalogRealtimeReady = useCatalogRealtimeReady();
  return useCatalogQuery(PROFESSIONALS_CATALOG, isCatalogRealtimeReady);
};

const useAcceptedCatalogChange = <T>(
  key: CatalogSource<T>['key'],
  mutation: { error: unknown; variables?: T; reset: () => void },
  isAccepted: (value: T, current: unknown) => boolean
) => {
  const client = useQueryClient();
  const { error, variables, reset } = mutation;
  useEffect(() => {
    if (!(error instanceof CatalogRemoteSyncError) || variables === undefined) return;
    const reconcile = () => {
      const accepted = client.getQueryData(catalogQueryKey(key));
      if (isAccepted(variables, accepted)) reset();
    };
    const unsubscribe = client.getQueryCache().subscribe(reconcile);
    reconcile();
    return unsubscribe;
  }, [client, key, error, variables, reset, isAccepted]);
  return mutation;
};

/**
 * Saves a whole catalog against the list it was edited from. Never saves over a list that was
 * not read, and on a conflict shows the list the server holds instead of the edit.
 */
const useCatalogSaveMutation = <T>(source: CatalogSource<T>) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (edit: CatalogEdit<T>) => {
      const base = Array.isArray(edit)
        ? source.savedBase(queryClient.getQueryData<T[]>(catalogQueryKey(source.key)))
        : edit.base;
      if (base === undefined) throw new CatalogReadUnavailableError();
      return source.save(catalogNext(edit), base);
    },
    networkMode: 'always',
    retry: false,
    onMutate: async () => {
      // Display fallbacks are not a loaded base for replacing the complete catalog.
      if (queryClient.getQueryData(catalogQueryKey(source.key)) === undefined) {
        throw new CatalogReadUnavailableError();
      }
      await queryClient.cancelQueries({ queryKey: catalogQueryKey(source.key) });
    },
    onSuccess: (result, edit) => {
      queryClient.setQueryData(
        catalogQueryKey(source.key),
        source.normalize(result ?? catalogNext(edit))
      );
    },
    onError: error => {
      if (error instanceof CatalogConflictError) {
        queryClient.setQueryData(catalogQueryKey(source.key), source.normalize(error.current));
      }
    },
  });
  useAcceptedCatalogChange(source.key, mutation, source.isAccepted);
  return mutation;
};

/** Saves the nurses catalog. */
export const useSaveNursesMutation = () => useCatalogSaveMutation(STAFF_CATALOGS.nurse);

/** Saves the TENS catalog. */
export const useSaveTensMutation = () => useCatalogSaveMutation(STAFF_CATALOGS.tens);

/** Saves the professionals catalog. */
export const useSaveProfessionalsMutation = () => useCatalogSaveMutation(PROFESSIONALS_CATALOG);
