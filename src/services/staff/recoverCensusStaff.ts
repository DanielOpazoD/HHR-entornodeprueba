import {
  collection,
  documentId,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { COLLECTIONS, HOSPITAL_COLLECTIONS, getActiveHospitalId } from '@/constants/firestorePaths';
import { defaultFirestoreServiceRuntime as runtime } from '@/services/storage/firestore/firestoreServiceRuntime';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { getAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import { collectCensusStaff, collectClinicalDerivedStaff } from './censusStaffDiscovery';
import { mergeEloisaStaff } from './eloisaStaffDiscovery';
import { saveDiscoveredStaff } from './eloisaStaffRegistry';
import type { EloisaStaffIdentity } from './eloisaStaffIdentity';

type ClinicalDerivedReadServiceModule =
  typeof import('@/services/repositories/dailyRecordClinicalDerivedReadService');

export const recoverCensusStaff = async (
  progress: (count: number) => void,
  signal?: AbortSignal
) => {
  if (!isFirestoreEnabled())
    throw new Error('Conecta con el servidor para actualizar el catálogo compartido.');
  await runtime.ready;
  let found: EloisaStaffIdentity[] = [];
  const dates = new Set<string>();
  const ingest = (record: Partial<DailyRecord>) => {
    found = mergeEloisaStaff(found, collectCensusStaff(record));
    if (record.date) dates.add(record.date);
    progress(dates.size);
  };
  let derivedReads: ClinicalDerivedReadServiceModule | undefined;
  // A split day keeps vitals authors in its episode documents (phase 1a, D10): read them all from
  // the server. A day that cannot be read fails the scan, so nothing partial is published.
  const ingestClinicalDerived = async (record: Partial<DailyRecord>) => {
    if (record.clinicalDerivedLayout == null || !record.date) return;
    derivedReads ??= await import('@/services/repositories/dailyRecordClinicalDerivedReadService');
    signal?.throwIfAborted();
    const result = await derivedReads.readClinicalDerivedDayDocs({
      date: record.date,
      clinicalDerivedLayout: record.clinicalDerivedLayout,
    });
    signal?.throwIfAborted();
    if (result.status === 'unavailable') {
      throw new Error(`No se pudieron leer los datos clínicos por episodio del ${record.date}.`);
    }
    if (result.status === 'resolved') {
      found = mergeEloisaStaff(found, collectClinicalDerivedStaff(result.docs));
    }
  };
  for (const record of Object.values(await getAllRecords())) ingest(record);
  const records = collection(
    runtime.getDb(),
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.DAILY_RECORDS
  );
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    signal?.throwIfAborted();
    const page = await getDocsFromServer(
      query(records, orderBy(documentId()), limit(50), ...(cursor ? [startAfter(cursor)] : []))
    );
    for (const snapshot of page.docs) {
      const record = { ...snapshot.data(), date: snapshot.id } as Partial<DailyRecord>;
      ingest(record);
      await ingestClinicalDerived(record);
    }
    if (page.size < 50) break;
    cursor = page.docs[page.docs.length - 1];
  }
  signal?.throwIfAborted();
  await saveDiscoveredStaff(found);
  return {
    censuses: dates.size,
    nurseCount: found.filter(entry => entry.role === 'nurse').length,
    tensCount: found.filter(entry => entry.role === 'tens').length,
  };
};
