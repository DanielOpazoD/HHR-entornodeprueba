import { liveQuery } from 'dexie';
import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  nursingRole,
  resolveEloisaStaffIdentity,
  type EloisaStaffIdentity,
  type StaffObservation,
} from './eloisaStaffIdentity';
import { mergeEloisaStaff, mergeStaffRegistries } from './eloisaStaffDiscovery';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getActiveHospitalId } from '@/constants/firestorePaths';

const catalogId = () => `eloisa-staff-identities-v1:${getActiveHospitalId()}`;
export const readEloisaStaff = async (): Promise<EloisaStaffIdentity[]> => {
  await ensureDbReady();
  const record = await hospitalDB.catalogs.get(catalogId());
  return (record?.list ?? []) as EloisaStaffIdentity[];
};

export const saveDiscoveredStaff = async (
  incoming: EloisaStaffIdentity[]
): Promise<EloisaStaffIdentity[]> => {
  await ensureDbReady();
  let identities = await hospitalDB.transaction('rw', hospitalDB.catalogs, async () => {
    const previous = ((await hospitalDB.catalogs.get(catalogId()))?.list ??
      []) as EloisaStaffIdentity[];
    const next = mergeStaffRegistries(incoming, previous);
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      await hospitalDB.catalogs.put({
        id: catalogId(),
        list: next,
        lastUpdated: new Date().toISOString(),
      });
    }
    return next;
  });
  if (isFirestoreEnabled()) {
    const { publishSharedStaffCatalog } = await import('./sharedEloisaStaffCatalog');
    identities = await publishSharedStaffCatalog(identities);
    await cacheSharedStaff(identities);
  }
  return identities;
};

/** Discovery is additive; shared confirmation must succeed before staffing inference. */
export const registerEloisaStaff = async <T extends StaffObservation>(
  observations: T[]
): Promise<T[]> => {
  if (!observations.length) return observations;
  const identities = await saveDiscoveredStaff(mergeEloisaStaff([], observations));
  return observations.map(observation => {
    const identity = resolveEloisaStaffIdentity(
      observation.author,
      identities,
      nursingRole(observation.role),
      observation.practitionerId
    );
    return {
      ...observation,
      resolvedStaffIdentity: identity
        ? {
            key: identity.key,
            name: identity.name,
            aliases: identity.aliases,
            catalogMatched: identity.manuallyCatalogued === true,
          }
        : undefined,
    };
  });
};

const cacheSharedStaff = async (entries: EloisaStaffIdentity[]) => {
  await ensureDbReady();
  await hospitalDB.transaction('rw', hospitalDB.catalogs, async () => {
    const current = ((await hospitalDB.catalogs.get(catalogId()))?.list ??
      []) as EloisaStaffIdentity[];
    const merged = mergeStaffRegistries(current, entries);
    if (JSON.stringify(current) !== JSON.stringify(merged))
      await hospitalDB.catalogs.put({
        id: catalogId(),
        list: merged,
        lastUpdated: new Date().toISOString(),
      });
  });
};

/**
 * The shared catalog is one remote document. Several consumers used to open one
 * listener each, so it is reference counted and torn down when the last one leaves.
 */
let sharedCatalogSubscribers = 0;
let sharedCatalogRelease: (() => void) | undefined;
let sharedCatalogPending: Promise<void> | undefined;

const retainSharedStaffCatalog = (error: (error: unknown) => void): (() => void) => {
  sharedCatalogSubscribers += 1;
  let released = false;
  if (sharedCatalogSubscribers === 1 && !sharedCatalogPending && !sharedCatalogRelease) {
    sharedCatalogPending = import('./sharedEloisaStaffCatalog')
      .then(module => {
        if (sharedCatalogSubscribers > 0) {
          sharedCatalogRelease = module.subscribeSharedStaffCatalog(entries => {
            void cacheSharedStaff(entries).catch(error);
          }, error);
        }
      })
      .catch(error)
      .finally(() => {
        sharedCatalogPending = undefined;
      });
  }
  return () => {
    if (released) return;
    released = true;
    sharedCatalogSubscribers = Math.max(0, sharedCatalogSubscribers - 1);
    if (sharedCatalogSubscribers === 0) {
      sharedCatalogRelease?.();
      sharedCatalogRelease = undefined;
    }
  };
};

export const subscribeEloisaStaff = (
  next: (entries: EloisaStaffIdentity[]) => void,
  error: (error: unknown) => void,
  shared = false
): (() => void) => {
  const subscription = liveQuery(readEloisaStaff).subscribe({ next, error });
  const releaseShared =
    shared && isFirestoreEnabled() ? retainSharedStaffCatalog(error) : undefined;
  return () => {
    releaseShared?.();
    subscription.unsubscribe();
  };
};
