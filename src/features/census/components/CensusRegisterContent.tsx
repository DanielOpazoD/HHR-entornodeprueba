import React, { type CSSProperties } from 'react';
import type { BedDefinition, DailyRecord, Statistics } from '@/types';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { formatCensusHeaderDate } from '@/features/census/controllers/censusDatePresentationController';
import { CensusActionsProvider } from './CensusActionsContext';
import { CMASection } from './CMASection';
import { CensusModals } from './CensusModals';
import { CensusStaffHeader } from './CensusStaffHeader';
import { DischargesSection } from './DischargesSection';
import { TransfersSection } from './TransfersSection';
import { CensusRegisterMainContent } from './CensusRegisterMainContent';

interface CensusRegisterContentProps {
  currentDateString: string;
  readOnly: boolean;
  localViewMode: 'TABLE' | '3D';
  beds: DailyRecord['beds'];
  visibleBeds: BedDefinition[];
  marginStyle: CSSProperties;
  stats: Statistics | null;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
}

export const CensusRegisterContent: React.FC<CensusRegisterContentProps> = ({
  currentDateString,
  readOnly,
  localViewMode,
  beds,
  visibleBeds,
  marginStyle,
  stats,
  showBedManagerModal,
  onCloseBedManagerModal,
}) => (
  <CensusActionsProvider>
    <div className="hidden print:flex flex-col items-center text-center mb-4 text-slate-900">
      <h1 className="text-2xl font-bold uppercase leading-tight">
        Censo diario de servicios hospitalizados - Hospital Hanga Roa
      </h1>
      <p className="text-sm font-semibold mt-1">
        Fecha: {formatCensusHeaderDate(currentDateString)}
      </p>
    </div>

    <div className="space-y-6" style={marginStyle}>
      <CensusStaffHeader readOnly={readOnly} stats={stats} />

      <CensusRegisterMainContent
        localViewMode={localViewMode}
        currentDateString={currentDateString}
        readOnly={readOnly}
        visibleBeds={visibleBeds}
        beds={beds}
      />

      <SectionErrorBoundary sectionName="Altas del Día" fallbackHeight="100px">
        <DischargesSection />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Traslados del Día" fallbackHeight="100px">
        <TransfersSection />
      </SectionErrorBoundary>

      <SectionErrorBoundary sectionName="Cirugía Mayor Ambulatoria" fallbackHeight="100px">
        <CMASection />
      </SectionErrorBoundary>

      {!readOnly && (
        <CensusModals
          showBedManagerModal={showBedManagerModal}
          onCloseBedManagerModal={onCloseBedManagerModal}
        />
      )}
    </div>
  </CensusActionsProvider>
);
