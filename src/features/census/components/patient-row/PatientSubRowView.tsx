import React from 'react';
import { User } from 'lucide-react';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { PatientInputCells } from './PatientInputCells';
import { shouldShowSubRowDemographicsButton } from '@/features/census/controllers/patientRowSubViewController';
import type { PatientSubRowViewProps } from '@/features/census/components/patient-row/patientRowContracts';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

export const PatientSubRowView: React.FC<PatientSubRowViewProps> = ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  diagnosisMode,
  accessProfile = 'default',
  style,
  onOpenDemographics,
  onChange,
}) => {
  const showDemographicsButton = shouldShowSubRowDemographicsButton({
    readOnly,
    specialistAccess: isSpecialistCensusAccessProfile(accessProfile),
  });

  return (
    <tr
      className="bg-white hover:bg-white transition-colors border-b border-slate-200 text-[13px] leading-tight"
      style={style}
      data-testid="patient-row"
    >
      <td className="p-0 text-right border-r border-slate-200 align-middle group/crib-config">
        <div className="flex justify-center items-center h-full gap-1">
          {showDemographicsButton && (
            <button
              onClick={onOpenDemographics}
              className="p-0.5 rounded bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              title="Datos demográficos"
            >
              <User size={12} />
            </button>
          )}
        </div>
      </td>
      <td className="p-0 border-r border-slate-200 text-center w-16">
        <MedicalBadge variant="purple" className="w-10 justify-center mx-auto">
          CUNA
        </MedicalBadge>
      </td>
      <PatientInputCells
        data={data}
        currentDateString={currentDateString}
        isSubRow={true}
        diagnosisMode={diagnosisMode}
        onChange={onChange}
        onDemo={onOpenDemographics}
        readOnly={readOnly}
        clinicalEditingDisabled={clinicalEditingDisabled}
        clinicalFieldLocks={clinicalFieldLocks}
        accessProfile={accessProfile}
      />
    </tr>
  );
};
