import { useEffect, useState } from 'react';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { subscribeEloisaStaff } from '@/services/staff/eloisaStaffRegistry';
import { logger } from '@/services/utils/loggerService';

export const useEloisaStaff = (shared = false): EloisaStaffIdentity[] => {
  const [entries, setEntries] = useState<EloisaStaffIdentity[]>([]);
  useEffect(
    () =>
      subscribeEloisaStaff(
        setEntries,
        () => {
          logger.warn('No se pudo leer el catálogo local de profesionales de Eloísa.');
        },
        shared
      ),
    [shared]
  );
  return entries;
};
