import React from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { AnalyticsView } from '@/features/analytics/components/AnalyticsView';
import { useCensusMigrationBootstrap } from '@/features/census/hooks/useCensusMigrationBootstrap';
import { useCensusViewModel } from '@/features/census/hooks/useCensusViewModel';
import { CensusRegisterContent, EmptyDayPrompt } from './index';

type ViewMode = 'REGISTER' | 'ANALYTICS';

interface CensusViewProps {
  viewMode: ViewMode;
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  readOnly?: boolean;
  localViewMode?: 'TABLE' | '3D';
}

const CensusViewContent: React.FC<CensusViewProps> = ({
  viewMode,
  selectedDay,
  selectedMonth,
  currentDateString,
  showBedManagerModal,
  onCloseBedManagerModal,
  readOnly = false,
  localViewMode = 'TABLE',
}) => {
  const {
    beds,
    previousRecordAvailable,
    previousRecordDate,
    availableDates,
    createDay,
    stats,
    marginStyle,
    visibleBeds,
  } = useCensusViewModel(currentDateString);

  useCensusMigrationBootstrap();

  if (viewMode === 'ANALYTICS') {
    return (
      <SectionErrorBoundary sectionName="Estadísticas">
        <AnalyticsView />
      </SectionErrorBoundary>
    );
  }

  if (!beds) {
    return (
      <EmptyDayPrompt
        selectedDay={selectedDay}
        selectedMonth={selectedMonth}
        previousRecordAvailable={previousRecordAvailable}
        previousRecordDate={previousRecordDate}
        availableDates={availableDates}
        onCreateDay={createDay}
        readOnly={readOnly}
      />
    );
  }

  return (
    <CensusRegisterContent
      currentDateString={currentDateString}
      readOnly={readOnly}
      localViewMode={localViewMode}
      beds={beds}
      visibleBeds={visibleBeds}
      marginStyle={marginStyle}
      stats={stats}
      showBedManagerModal={showBedManagerModal}
      onCloseBedManagerModal={onCloseBedManagerModal}
    />
  );
};

// Exported component
export const CensusView: React.FC<CensusViewProps> = CensusViewContent;
