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
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { collectCensusStaff } from './censusStaffDiscovery';
import { mergeEloisaStaff } from './eloisaStaffDiscovery';
import { saveDiscoveredStaff } from './eloisaStaffRegistry';
import type { EloisaStaffIdentity } from './eloisaStaffIdentity';

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
    page.docs.forEach(snapshot =>
      ingest({ ...snapshot.data(), date: snapshot.id } as Partial<DailyRecord>)
    );
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
