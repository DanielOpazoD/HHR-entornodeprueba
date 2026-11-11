import type { ReactNode } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { BedDefinition } from '@/types/domain/beds';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

export interface CensusMedicalHandoffActionContext {
  record: DailyRecord;
  visibleBeds: readonly BedDefinition[];
  professionalsCatalog: ProfessionalCatalogItem[];
}

export type RenderCensusMedicalHandoffAction = (
  context: CensusMedicalHandoffActionContext
) => ReactNode;
