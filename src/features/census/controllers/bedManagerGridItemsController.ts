import type { BedDefinition, DailyRecord } from '@/types';

export interface BedManagerBlockedGridItem {
  id: string;
  name: string;
  isBlocked: boolean;
  blockedReason?: string;
}

export interface BedManagerExtraGridItem {
  id: string;
  name: string;
  isEnabled: boolean;
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

export const resolveExtraBedsGridItems = (
  beds: BedDefinition[],
  activeExtraBeds: string[] | null | undefined
): BedManagerExtraGridItem[] =>
  beds
    .filter(bed => bed.isExtra)
    .map(bed => ({
      id: bed.id,
      name: bed.name,
      isEnabled: (activeExtraBeds || []).includes(bed.id),
    }));
