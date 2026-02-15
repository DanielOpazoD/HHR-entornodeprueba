import React from 'react';
import { Loader2 } from 'lucide-react';
import type { BedDefinition, DailyRecord } from '@/types';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { CensusTable } from './CensusTable';

interface CensusRegisterMainContentProps {
  localViewMode: 'TABLE' | '3D';
  currentDateString: string;
  readOnly: boolean;
  visibleBeds: BedDefinition[];
  beds: DailyRecord['beds'];
}

const HospitalFloorMap = React.lazy(() => import('./3d/HospitalFloorMap'));

export const CensusRegisterMainContent: React.FC<CensusRegisterMainContentProps> = ({
  localViewMode,
  currentDateString,
  readOnly,
  visibleBeds,
  beds,
}) => {
  if (localViewMode === 'TABLE') {
    return (
      <SectionErrorBoundary sectionName="Tabla de Pacientes" fallbackHeight="400px">
        <CensusTable currentDateString={currentDateString} readOnly={readOnly} />
      </SectionErrorBoundary>
    );
  }

  return (
    <div className="animate-fade-in">
      <React.Suspense
        fallback={
          <div className="h-[500px] w-full bg-slate-50 rounded-xl flex flex-col items-center justify-center border border-slate-200">
            <Loader2 className="animate-spin text-indigo-500 mb-2" size={32} />
            <p className="text-slate-500 font-medium text-sm">Cargando entorno 3D...</p>
          </div>
        }
      >
        <HospitalFloorMap beds={visibleBeds} patients={beds} />
      </React.Suspense>
    </div>
  );
};
