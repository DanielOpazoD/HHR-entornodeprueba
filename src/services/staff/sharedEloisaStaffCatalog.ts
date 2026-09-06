import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { defaultFirestoreServiceRuntime as runtime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  COLLECTIONS,
  HOSPITAL_COLLECTIONS,
  SETTINGS_DOCS,
  getActiveHospitalId,
} from '@/constants/firestorePaths';
import { mergeStaffRegistries } from './eloisaStaffDiscovery';
import {
  mergeStaffCatalog,
  resolveEloisaStaffIdentity,
  type EloisaStaffIdentity,
} from './eloisaStaffIdentity';

export const SHARED_STAFF_DOC = 'eloisa_staff_catalog';
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const identities = (value: unknown): EloisaStaffIdentity[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is EloisaStaffIdentity =>
          v &&
          typeof v.key === 'string' &&
          typeof v.name === 'string' &&
          ['nurse', 'tens'].includes(v.role) &&
          Array.isArray(v.aliases) &&
          v.aliases.every((a: unknown) => typeof a === 'string')
      )
    : [];
const ref = (id: string) =>
  doc(
    runtime.getDb(),
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.SETTINGS,
    id
  );

/** Pure additive plan; the source catalog is not a census of everybody currently working. */
export const planSharedStaffCatalog = (
  previous: EloisaStaffIdentity[],
  incoming: EloisaStaffIdentity[],
  nurses: string[],
  tens: string[]
) => {
  // Shared provenance wins over an older local cache for the same identity.
  const merged = mergeStaffRegistries(incoming, previous);
  const entries = merged.map(entry => ({
    ...entry,
    manuallyCatalogued:
      entry.manuallyCatalogued ??
      (entry.role === 'nurse' ? nurses : tens).some(
        name => resolveEloisaStaffIdentity(name, merged, entry.role)?.key === entry.key
      ),
  }));
  return {
    entries,
    nurseNames: mergeStaffCatalog(nurses, entries, 'nurse'),
    tensNames: mergeStaffCatalog(tens, entries, 'tens'),
  };
};

export const publishSharedStaffCatalog = async (
  incoming: EloisaStaffIdentity[]
): Promise<EloisaStaffIdentity[]> => {
  await runtime.ready;
  const sharedRef = ref(SHARED_STAFF_DOC),
    nurseRef = ref(SETTINGS_DOCS.NURSES),
    tensRef = ref(SETTINGS_DOCS.TENS);
  return runTransaction(runtime.getDb(), async transaction => {
    const [shared, nurses, tens] = await Promise.all([
      transaction.get(sharedRef),
      transaction.get(nurseRef),
      transaction.get(tensRef),
    ]);
    const previous = identities(shared.data()?.list);
    const { list: nurseList, nurses: legacyNurses } = nurses.data() ?? {};
    const nurseNames = list(nurseList ?? legacyNurses);
    const tensNames = list(tens.data()?.list ?? tens.data()?.tens);
    const plan = planSharedStaffCatalog(previous, incoming, nurseNames, tensNames);
    const lastUpdated = new Date().toISOString();
    if (JSON.stringify(previous) !== JSON.stringify(plan.entries))
      transaction.set(sharedRef, { list: plan.entries, lastUpdated }, { merge: true });
    if (JSON.stringify(nurseNames) !== JSON.stringify(plan.nurseNames))
      transaction.set(
        nurseRef,
        { list: plan.nurseNames, nurses: plan.nurseNames, lastUpdated },
        { merge: true }
      );
    if (JSON.stringify(tensNames) !== JSON.stringify(plan.tensNames))
      transaction.set(
        tensRef,
        { list: plan.tensNames, tens: plan.tensNames, lastUpdated },
        { merge: true }
      );
    return plan.entries;
  });
};

export const subscribeSharedStaffCatalog = (
  next: (entries: EloisaStaffIdentity[]) => void,
  error: (error: unknown) => void
): (() => void) =>
  onSnapshot(ref(SHARED_STAFF_DOC), snapshot => next(identities(snapshot.data()?.list)), error);
