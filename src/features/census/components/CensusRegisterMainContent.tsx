import React from 'react';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { CensusTable } from './CensusTable';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import type { CensusAttentionFilter } from '@/features/census/controllers/rowAcuityController';

interface CensusRegisterMainContentProps {
  currentDateString: string;
  readOnly: boolean;
  visibleBeds: BedDefinition[];
  beds: DailyRecord['beds'];
  accessProfile: CensusAccessProfile;
  attentionFilter?: CensusAttentionFilter;
  onClearAttentionFilter?: () => void;
}

export const CensusRegisterMainContent: React.FC<CensusRegisterMainContentProps> = ({
  currentDateString,
  readOnly,
  visibleBeds: _visibleBeds,
  beds: _beds,
  accessProfile,
  attentionFilter = 'all',
  onClearAttentionFilter,
}) => (
  <SectionErrorBoundary sectionName="Tabla de Pacientes" fallbackHeight="400px">
    <CensusTable
      currentDateString={currentDateString}
      readOnly={readOnly}
      accessProfile={accessProfile}
      attentionFilter={attentionFilter}
      onClearAttentionFilter={onClearAttentionFilter}
    />
  </SectionErrorBoundary>
);
