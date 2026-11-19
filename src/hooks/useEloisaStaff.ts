import { useEffect, useState } from 'react';
import type { EloisaStaffIdentity } from '@/services/staff/eloisaStaffIdentity';
import { subscribeEloisaStaff } from '@/services/staff/eloisaStaffRegistry';
import { logger } from '@/services/utils/loggerService';

/** The Eloísa staff on this computer; undefined until read, because unknown is not «nobody». */
export const useEloisaStaff = (shared = false): EloisaStaffIdentity[] | undefined => {
  const [entries, setEntries] = useState<EloisaStaffIdentity[]>();
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
