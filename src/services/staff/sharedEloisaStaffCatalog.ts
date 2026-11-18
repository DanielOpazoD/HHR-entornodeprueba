import { isSpellingOf, preferredStaffName } from './nurseIdentity';
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
  readStaffIdentities,
  resolveEloisaStaffIdentity,
  staffPerson,
  type EloisaStaffIdentity,
} from './eloisaStaffIdentity';

export const SHARED_STAFF_DOC = SETTINGS_DOCS.ELOISA_STAFF;
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
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
    // The saved spelling of this same person stays unless Eloísa's has more marks.
    name: (entry.role === 'nurse' ? nurses : tens)
      .filter(
        name =>
          isSpellingOf(name, entry.name) && staffPerson(name, merged, entry.role).key === entry.key
      )
      .reduce((preferred, name) => preferredStaffName(name, preferred), entry.name),
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
  incoming: EloisaStaffIdentity[],
  check: () => void = () => undefined
): Promise<EloisaStaffIdentity[]> => {
  await runtime.ready;
  check();
  const sharedRef = ref(SHARED_STAFF_DOC),
    nurseRef = ref(SETTINGS_DOCS.NURSES),
    tensRef = ref(SETTINGS_DOCS.TENS);
  return runTransaction(runtime.getDb(), async transaction => {
    check();
    const [shared, nurses, tens] = await Promise.all([
      transaction.get(sharedRef),
      transaction.get(nurseRef),
      transaction.get(tensRef),
    ]);
    check();
    const previous = readStaffIdentities(shared.data()?.list);
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
  onSnapshot(
    ref(SHARED_STAFF_DOC),
    snapshot => next(readStaffIdentities(snapshot.data()?.list)),
    error
  );
