import React from 'react';
import { User } from 'lucide-react';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { PatientInputCells } from './PatientInputCells';
import { shouldShowSubRowDemographicsButton } from '@/features/census/controllers/patientRowSubViewController';
import type { PatientSubRowViewProps } from '@/features/census/components/patient-row/patientRowViewContracts';

export const PatientSubRowView: React.FC<PatientSubRowViewProps> = ({
  data,
  currentDateString,
  readOnly,
  style,
  onOpenDemographics,
  onChange,
}) => {
  const showDemographicsButton = shouldShowSubRowDemographicsButton({ readOnly });

  return (
    <tr
      className="hover:bg-slate-50 transition-colors border-b border-slate-200 text-[13px] leading-tight"
      style={style}
      data-testid="patient-row"
    >
      <td className="border-r border-slate-200 text-center p-0 w-10">
        {/* Action Column Spacer */}
      </td>
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
        onChange={onChange}
        onDemo={onOpenDemographics}
        readOnly={readOnly}
      />
    </tr>
  );
};
