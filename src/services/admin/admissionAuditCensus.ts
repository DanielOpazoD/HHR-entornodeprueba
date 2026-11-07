import { getRecordsRangeFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { getNextDay, getPreviousDay } from '@/utils/clinicalDayUtils';

/** Server-only read, month-sized batches; never substitute offline cache for an audit cohort. */
export async function* readAdmissionAuditCensus(from: string, to: string, signal: AbortSignal) {
  let start = getPreviousDay(from);
  const end = getNextDay(to);
  while (start <= end) {
    signal.throwIfAborted();
    const calendar = new Date(`${start}T00:00:00Z`);
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const last = new Date(Date.UTC(year, month, 0));
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
    const through = monthEnd < end ? monthEnd : end;
    const records = await getRecordsRangeFromFirestore(start, through, { requireServer: true });
    signal.throwIfAborted();
    yield records;
    start = getNextDay(through);
  }
}
