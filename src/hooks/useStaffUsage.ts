import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { countStaffUsage, type StaffUsage } from '@/services/staff/staffUsage';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { collectRecordedStaffNames } from '@/services/staff/dailyRecordStaffing';
import { getActiveHospitalId } from '@/constants/firestorePaths';

/**
 * Cache only staffing fields for both roles; clinical edits must not rescan 90 censuses.
 * The counts only order the nurse and TENS pickers, so one read per session is enough:
 * the key sits outside `['staff']`, which the staleness guard invalidates on every tab
 * return, and focus or reconnect do not re-read it.
 */
export const useStaffUsage = (identities: EloisaStaffIdentity[]): StaffUsage => {
  const { data } = useQuery({
    queryKey: ['staffUsage', getActiveHospitalId()],
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async () => {
      await ensureDbReady();
      const records = await hospitalDB.dailyRecords.orderBy('date').reverse().limit(90).toArray();
      return records.map(record => {
        const { nurseNames, tensNames } = collectRecordedStaffNames(record);
        return { nurses: nurseNames, tensDayShift: tensNames };
      });
    },
  });
  return useMemo(() => countStaffUsage(data ?? [], identities), [data, identities]);
};
