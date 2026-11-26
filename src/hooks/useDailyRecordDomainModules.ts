import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useBedManagement } from '@/hooks/useBedManagement';
import type { StaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';
import { useInventory } from '@/hooks/useInventory';
import { useStabilityRules } from '@/hooks/useStabilityRules';

/**
 * Core daily-record hooks shared across authenticated routes (inventory, stability rules and
 * bed mutations). Route-specific actions (nursing handoff, census movements and shift staffing)
 * are composed inside their owning features so they stay out of `app-authenticated-shell`.
 */
export const useDailyRecordDomainModules = (
  record: DailyRecord | null,
  patchRecord: ApplyDailyRecordPatch,
  ensureStaleDayEditAllowed?: StaleDayEditGuard
) => {
  const inventory = useInventory(record);
  const stabilityRules = useStabilityRules(record);
  const bedManagement = useBedManagement(record, patchRecord, ensureStaleDayEditAllowed);

  return {
    inventory,
    stabilityRules,
    bedManagement,
  };
};
