import type { ReactNode } from 'react';
import type { DailyRecord } from './censusRecordContracts';
import type { BedDefinition } from './censusBedContracts';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

export interface CensusMedicalHandoffActionContext {
  record: DailyRecord;
  visibleBeds: readonly BedDefinition[];
  professionalsCatalog: ProfessionalCatalogItem[];
}

export type RenderCensusMedicalHandoffAction = (
  context: CensusMedicalHandoffActionContext
) => ReactNode;
