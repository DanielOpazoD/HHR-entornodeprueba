import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { countStaffUsage, type StaffUsage } from '@/services/staff/staffUsage';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { collectRecordedStaffNames } from '@/services/staff/dailyRecordStaffing';
import { getActiveHospitalId } from '@/constants/firestorePaths';

/** Cache only staffing fields for both roles; clinical edits must not rescan 90 censuses. */
export const useStaffUsage = (identities: EloisaStaffIdentity[]): StaffUsage => {
  const { data } = useQuery({
    queryKey: ['staff', 'local-usage', getActiveHospitalId()],
    staleTime: 5 * 60_000,
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
