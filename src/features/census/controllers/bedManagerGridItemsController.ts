import type { BedDefinition } from '@/types/domain/beds';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export interface BedManagerBlockedGridItem {
  id: string;
  name: string;
  isBlocked: boolean;
  blockedReason?: string;
}

export const resolveBlockedBedsGridItems = (
  beds: BedDefinition[],
  recordBeds: DailyRecord['beds'] | null | undefined
): BedManagerBlockedGridItem[] =>
  beds
    .filter(bed => !bed.isExtra)
    .map(bed => ({
      id: bed.id,
      name: bed.name,
      isBlocked: Boolean(recordBeds?.[bed.id]?.isBlocked),
      blockedReason: recordBeds?.[bed.id]?.blockedReason || '',
    }));
